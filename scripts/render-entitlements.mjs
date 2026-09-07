// Renders build/entitlements.mac.plist from the template using XPILOT_TEAM_ID.
import { readFileSync, writeFileSync } from 'node:fs';
const team = (process.env.XPILOT_TEAM_ID ?? '').trim();
if (!/^[A-Z0-9]{10}$/.test(team)) {
  console.error('XPILOT_TEAM_ID must be your 10-character Apple Team ID (see docs/passkeys.md)');
  process.exit(1);
}
const out = readFileSync(new URL('../build/entitlements.mac.plist.in', import.meta.url), 'utf8').replaceAll('@TEAM_ID@', team);
writeFileSync(new URL('../build/entitlements.mac.plist', import.meta.url), out);
console.log(`wrote build/entitlements.mac.plist for team ${team}`);
