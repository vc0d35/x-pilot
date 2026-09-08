// Renders build/entitlements.mac.plist from the template.
//
// With XPILOT_TEAM_ID: the passkey keychain group is rendered for that team.
// Without it: the keychain-access-groups entitlement is dropped. It is a restricted
// entitlement, so an app carrying it without a matching provisioning profile is
// SIGKILLed at launch (see docs/passkeys.md); a build with no team id has no profile.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const team = (process.env.XPILOT_TEAM_ID ?? '').trim();
const template = readFileSync(new URL('../build/entitlements.mac.plist.in', import.meta.url), 'utf8');
const target = new URL('../build/entitlements.mac.plist', import.meta.url);
const hasProfile = existsSync(new URL('../build/embedded.provisionprofile', import.meta.url));

if (team !== '' && !hasProfile) console.warn('XPILOT_TEAM_ID is set but build/embedded.provisionprofile is missing: passkeys are disabled in this build');

if (team === '' || !hasProfile) {
  const stripped = template.replace(
    /[ \t]*<!--[^>]*Touch ID passkeys[^>]*-->\n[ \t]*<key>keychain-access-groups<\/key>\n[ \t]*<array>[\s\S]*?<\/array>\n/,
    '',
  );
  if (stripped.includes('keychain-access-groups')) {
    console.error('could not strip keychain-access-groups from build/entitlements.mac.plist.in');
    process.exit(1);
  }
  writeFileSync(target, stripped);
  console.log('wrote build/entitlements.mac.plist without keychain-access-groups: passkeys are disabled in this build (set XPILOT_TEAM_ID, see docs/passkeys.md)');
} else if (!/^[A-Z0-9]{10}$/.test(team)) {
  console.error('XPILOT_TEAM_ID must be your 10-character Apple Team ID, or unset (see docs/passkeys.md)');
  process.exit(1);
} else {
  writeFileSync(target, template.replaceAll('@TEAM_ID@', team));
  console.log(`wrote build/entitlements.mac.plist for team ${team}`);
}
