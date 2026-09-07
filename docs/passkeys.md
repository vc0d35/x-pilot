# Touch ID passkeys in X Pilot

X's passkey login uses the browser's WebAuthn platform authenticator. Electron only
services those requests after `app.configureWebAuthn` is called, and its authenticator
stores credentials in this Mac's Secure Enclave under a keychain access group that must
be granted by a code-signing entitlement. Two consequences:

- The app (even the dev binary) must be signed with an Apple-issued certificate whose
  Team ID matches the group `<TEAM_ID>.com.vicnicius.xpilot.webauthn`.
- Passkeys created here are device-bound and never synced. Your existing iCloud
  Keychain passkey cannot be used inside X Pilot; you register a new one from the app.

## 1. Get a Team ID and a signing certificate

1. Open Xcode → Settings… → Accounts → `+` → sign in with your Apple ID.
   A free Apple ID gives you a "Personal Team"; a paid Apple Developer Program
   membership gives a regular team (needed only for notarised distribution).
2. Select the account → Manage Certificates… → `+` → **Apple Development**.
3. Find your Team ID: it is shown next to the team name in that Accounts pane, or run

   ```bash
   security find-identity -v -p codesigning
   ```

   and copy the 10-character code in parentheses, e.g. `Apple Development: you@example.com (A1B2C3D4E5)`.

## 2. Development (`npm run dev`)

```bash
export XPILOT_TEAM_ID=A1B2C3D4E5   # your Team ID
npm run sign-dev                   # re-signs node_modules/electron with the entitlement
XPILOT_TEAM_ID=$XPILOT_TEAM_ID npm run dev
```

Re-run `npm run sign-dev` after every `npm install` that updates Electron. The main
process logs `passkeys enabled with keychain group …` on startup; without
`XPILOT_TEAM_ID` it logs `passkeys disabled` and everything else works as before.
Set `XPILOT_KEYCHAIN_GROUP` instead to use a custom group.

## 3. Packaged build

```bash
XPILOT_TEAM_ID=A1B2C3D4E5 npm run dist
```

electron-builder signs `dist/mac*/X Pilot.app` with your identity and the rendered
`build/entitlements.mac.plist`.

## 4. First login

1. Sign in to X once with another second factor (authenticator app, SMS, or a backup
   code). The session persists in the app.
2. In X: Settings → Security and account access → Security → Two-factor authentication
   → Security key (or Passkeys) → add. macOS shows `"X Pilot" is trying to sign in to
   x.com` with Touch ID; approve it.
3. From now on, passkey prompts inside X Pilot are answered with Touch ID.

If macOS refuses the keychain group on a Personal Team, the Touch ID prompt never
appears and the log shows a keychain error; a paid team is the fallback.
