#!/usr/bin/env bash
# Signs the Electron binary used by `npm run dev` so Touch ID passkeys work in development.
#
# macOS treats `keychain-access-groups` as a restricted entitlement: a process carrying it
# is killed at launch unless the app embeds a provisioning profile that authorises the
# group. So this script:
#   1. finds your "Apple Development" identity and derives the Team ID from it;
#   2. looks for a macOS development provisioning profile for com.vicnicius.xpilot
#      (created by Xcode, see docs/passkeys.md) that grants the keychain group;
#   3. with a profile: sets the dev app's bundle id, embeds the profile, signs helpers
#      with base entitlements and the app with the keychain entitlement;
#      without one: signs everything with base entitlements (passkeys stay disabled);
#   4. verifies the binary still launches.
set -euo pipefail
cd "$(dirname "$0")/.."
APP=node_modules/electron/dist/Electron.app
BUNDLE_ID=com.vicnicius.xpilot

IDENTITY="${XPILOT_SIGN_IDENTITY:-$(security find-identity -v -p codesigning | grep -m1 "Apple Development" | sed -E 's/.*"(.*)"/\1/' || true)}"
if [ -z "$IDENTITY" ]; then
  echo "No valid 'Apple Development' signing identity found. See docs/passkeys.md." >&2
  exit 1
fi
if [ -z "${XPILOT_TEAM_ID:-}" ]; then
  XPILOT_TEAM_ID=$(security find-certificate -c "$IDENTITY" -p | openssl x509 -noout -subject 2>/dev/null | sed -nE 's/.*OU ?= ?([A-Z0-9]{10}).*/\1/p')
  export XPILOT_TEAM_ID
fi
: "${XPILOT_TEAM_ID:?could not derive the Team ID from the certificate; set XPILOT_TEAM_ID explicitly}"
GROUP="$XPILOT_TEAM_ID.$BUNDLE_ID.webauthn"
echo "Identity: $IDENTITY"
echo "Team ID:  $XPILOT_TEAM_ID"

# --- find a provisioning profile that authorises the keychain group -----------------
PROFILE=""
for f in ~/Library/Developer/Xcode/UserData/Provisioning\ Profiles/*.provisionprofile ~/Library/MobileDevice/Provisioning\ Profiles/*.provisionprofile; do
  [ -f "$f" ] || continue
  plist=$(security cms -D -i "$f" 2>/dev/null || true)
  # Personal-team ("Mac Team") profiles are wildcards: application-identifier and
  # keychain-access-groups are "<TEAM>.*", which authorises our bundle id and group.
  echo "$plist" | grep -qE "<string>$XPILOT_TEAM_ID\.(\*|$BUNDLE_ID)</string>" || continue
  echo "$plist" | grep -qE "<string>($GROUP|$XPILOT_TEAM_ID\.\*)</string>" || continue
  PROFILE="$f"; break
done

node scripts/render-entitlements.mjs >/dev/null
sign_helpers() {
  # inside-out: frameworks and helper apps first, with base entitlements
  find "$APP/Contents/Frameworks" -depth \( -name "*.framework" -o -name "*.app" -o -name "*.dylib" \) -print0 \
    | xargs -0 -I{} codesign --force --sign "$IDENTITY" --entitlements build/entitlements.mac.inherit.plist {} 2>/dev/null
}

if [ -n "$PROFILE" ]; then
  echo "Profile:  $PROFILE"
  /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $BUNDLE_ID" "$APP/Contents/Info.plist"
  cp "$PROFILE" "$APP/Contents/embedded.provisionprofile"
  sign_helpers
  codesign --force --sign "$IDENTITY" --entitlements build/entitlements.mac.plist "$APP"
  MODE="passkeys ENABLED (keychain group $GROUP)"
else
  echo "No provisioning profile for $BUNDLE_ID with keychain group $GROUP found."
  echo "Passkeys stay disabled. To create one, follow docs/passkeys.md § Provisioning profile."
  rm -f "$APP/Contents/embedded.provisionprofile"
  sign_helpers
  codesign --force --sign "$IDENTITY" --entitlements build/entitlements.mac.inherit.plist "$APP"
  MODE="passkeys DISABLED (no provisioning profile)"
fi

# --- verify the result launches (a restricted entitlement without a profile is SIGKILLed) ---
if ! "$APP/Contents/MacOS/Electron" --version >/dev/null 2>&1; then
  echo "Signed binary does not launch (macOS killed it). Re-signing with base entitlements so npm run dev keeps working." >&2
  rm -f "$APP/Contents/embedded.provisionprofile"
  codesign --force --sign "$IDENTITY" --entitlements build/entitlements.mac.inherit.plist "$APP"
  "$APP/Contents/MacOS/Electron" --version >/dev/null
  echo "Check that the profile's bundle id, team and keychain group match; see docs/passkeys.md." >&2
  exit 1
fi
echo "OK: $MODE"
[ -n "$PROFILE" ] && echo "Run: XPILOT_TEAM_ID=$XPILOT_TEAM_ID npm run dev" || true
