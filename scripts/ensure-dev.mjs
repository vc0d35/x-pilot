// Runs after `npm install` and before `npm run dev`. Electron 44 ships no postinstall: its binary
// is fetched only by its own `install-electron` command, so a plain install leaves it missing and
// electron-vite reports the baffling "Electron uninstall". The tracked files under build/ have
// gone missing from this checkout more than once too. Each is restored only when missing, and
// says so, so a deliberate change is never overwritten.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const electronDir = join(root, 'node_modules', 'electron');

if (existsSync(electronDir) && !existsSync(join(electronDir, 'path.txt'))) {
  console.log('[xpilot] downloading the Electron binary (electron ships no postinstall of its own)');
  execFileSync(process.execPath, [join(electronDir, 'install.js')], { cwd: electronDir, stdio: 'inherit' });
}

const missing = ['build/icon.png', 'build/icon.icns', 'build/entitlements.mac.plist.in', 'build/entitlements.mac.inherit.plist'].filter(
  (f) => !existsSync(join(root, f)),
);
if (missing.length > 0 && existsSync(join(root, '.git'))) {
  console.log(`[xpilot] restoring from git: ${missing.join(', ')}`);
  execFileSync('git', ['checkout', '--', ...missing], { cwd: root, stdio: 'inherit' });
}
