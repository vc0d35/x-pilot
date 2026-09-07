#!/usr/bin/env bash
# Re-signs the Electron binary used by `npm run dev` with your Apple Development
# identity and the Touch ID keychain entitlement, so passkeys work in development.
# Usage: XPILOT_TEAM_ID=A1B2C3D4E5 npm run sign-dev   (identity auto-detected)
set -euo pipefail
cd "$(dirname "$0")/.."
: "${XPILOT_TEAM_ID:?set XPILOT_TEAM_ID to your 10-character Apple Team ID (see docs/passkeys.md)}"
IDENTITY="${XPILOT_SIGN_IDENTITY:-$(security find-identity -v -p codesigning | grep -m1 "Apple Development" | sed -E 's/.*"(.*)"/\1/' || true)}"
if [ -z "$IDENTITY" ]; then
  echo "No 'Apple Development' signing identity found. Create one in Xcode → Settings → Accounts → Manage Certificates (see docs/passkeys.md)." >&2
  exit 1
fi
node scripts/render-entitlements.mjs
APP=node_modules/electron/dist/Electron.app
echo "Signing $APP as \"$IDENTITY\""
codesign --force --deep --sign "$IDENTITY" --entitlements build/entitlements.mac.plist "$APP"
codesign -d --entitlements :- "$APP" 2>/dev/null | grep -q "$XPILOT_TEAM_ID.com.vicnicius.xpilot.webauthn" && echo "Entitlement present. Run: XPILOT_TEAM_ID=$XPILOT_TEAM_ID npm run dev"
