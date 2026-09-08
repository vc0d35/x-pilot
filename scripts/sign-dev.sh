#!/usr/bin/env bash
# Re-signs the Electron binary used by `npm run dev` with your Apple Development
# identity and the Touch ID keychain entitlement, so passkeys work in development.
# Usage: XPILOT_TEAM_ID=A1B2C3D4E5 npm run sign-dev   (identity auto-detected)
set -euo pipefail
cd "$(dirname "$0")/.."
IDENTITY="${XPILOT_SIGN_IDENTITY:-$(security find-identity -v -p codesigning | grep -m1 "Apple Development" | sed -E 's/.*"(.*)"/\1/' || true)}"
if [ -z "$IDENTITY" ]; then
  echo "No valid 'Apple Development' signing identity found. See docs/passkeys.md (Xcode → Settings → Accounts → Manage Certificates; if it shows as invalid, install Apple's WWDR G3 intermediate)." >&2
  exit 1
fi
# The Team ID is the certificate's OU field (the code in parentheses is a certificate id, not the team).
if [ -z "${XPILOT_TEAM_ID:-}" ]; then
  XPILOT_TEAM_ID=$(security find-certificate -c "$IDENTITY" -p | openssl x509 -noout -subject 2>/dev/null | sed -nE 's/.*OU ?= ?([A-Z0-9]{10}).*/\1/p')
  export XPILOT_TEAM_ID
fi
: "${XPILOT_TEAM_ID:?could not derive the Team ID from the certificate; set XPILOT_TEAM_ID explicitly}"
echo "Team ID: $XPILOT_TEAM_ID"
node scripts/render-entitlements.mjs
APP=node_modules/electron/dist/Electron.app
echo "Signing $APP as \"$IDENTITY\""
codesign --force --deep --sign "$IDENTITY" --entitlements build/entitlements.mac.plist "$APP"
codesign -d --entitlements :- "$APP" 2>/dev/null | grep -q "$XPILOT_TEAM_ID.com.vicnicius.xpilot.webauthn" && echo "Entitlement present. Run: XPILOT_TEAM_ID=$XPILOT_TEAM_ID npm run dev"
