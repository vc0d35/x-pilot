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
3. Check the certificate is valid:

   ```bash
   security find-identity -v -p codesigning
   ```

   If it says `0 valid identities found` even though Xcode created the certificate, your
   keychain is missing Apple's current intermediate. Install it and re-check:

   ```bash
   curl -sSLO https://www.apple.com/certificateauthority/AppleWWDRCAG3.cer
   security import AppleWWDRCAG3.cer -k ~/Library/Keychains/login.keychain-db
   ```

4. Your Team ID is the certificate's `OU` field (the code in parentheses on an
   "Apple Development" certificate is a certificate id, not the team). `npm run sign-dev`
   derives it automatically; to see it yourself:

   ```bash
   security find-certificate -c "Apple Development" -p | openssl x509 -noout -subject
   ```

## 2. Provisioning profile (required)

macOS treats `keychain-access-groups` as a *restricted* entitlement: an app that carries it
without an embedded provisioning profile authorising the group is killed at launch
(exit 137, no crash report). Electron's docs omit this. Create a macOS development
profile once:

1. Xcode → File → New → Project → macOS → App. Product name `XPilotSigning`,
   organisation identifier `com.vicnicius`, so the bundle id is `com.vicnicius.xpilot`
   (edit it in Signing & Capabilities if Xcode appends the product name).
2. Signing & Capabilities: tick "Automatically manage signing", pick your team,
   then `+ Capability` → **Keychain Sharing** → add the group `com.vicnicius.xpilot.webauthn`
   (Xcode stores it as `$(AppIdentifierPrefix)com.vicnicius.xpilot.webauthn`).
3. Build the project once (⌘B). Xcode writes the profile to
   `~/Library/Developer/Xcode/UserData/Provisioning Profiles/*.provisionprofile`.
   The throwaway project can be deleted afterwards; the profile stays.

`npm run sign-dev` finds the profile by team, bundle id and group. For packaged builds
copy it to `build/embedded.provisionprofile` (git-ignored).

## 3. Development (`npm run dev`)

```bash
npm run sign-dev            # derives your Team ID, embeds the profile, re-signs node_modules/electron
XPILOT_TEAM_ID=<printed>  npm run dev
```

The script prints `passkeys ENABLED` or, without a profile, `passkeys DISABLED` and
signs with base entitlements so the app still runs. Re-run it after any `npm install`
that updates Electron. The main process logs `passkeys enabled with keychain group …`
on startup. Set `XPILOT_KEYCHAIN_GROUP` to use a custom group.

## 4. Packaged build

```bash
cp ~/Library/Developer/Xcode/UserData/Provisioning\ Profiles/<the-profile>.provisionprofile build/embedded.provisionprofile
XPILOT_TEAM_ID=<your team id> npm run dist
```

electron-builder signs `dist/mac*/X Pilot.app` with your identity, the rendered
`build/entitlements.mac.plist` (app) and `build/entitlements.mac.inherit.plist`
(helpers), and embeds the profile.

## 5. First login

1. Sign in to X once with another second factor (authenticator app, SMS, or a backup
   code). The session persists in the app.
2. In X: Settings → Security and account access → Security → Two-factor authentication
   → Security key (or Passkeys) → add. macOS shows `"X Pilot" is trying to sign in to
   x.com` with Touch ID; approve it.
3. From now on, passkey prompts inside X Pilot are answered with Touch ID.

If macOS refuses the keychain group on a Personal Team, the Touch ID prompt never
appears and the log shows a keychain error; a paid team is the fallback.
