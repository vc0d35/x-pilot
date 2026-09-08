import { execFile } from 'node:child_process';
import { accessSync, constants, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { locateCodex } from './locate';

export const CODEX_MISSING_MESSAGE =
  'Codex CLI not found. Install it with `npm i -g @openai/codex`, run `codex login`, or set the binary path in Settings.';

const LOGIN_SHELL_TIMEOUT_MS = 3000;

function isExecutable(path: string): boolean {
  try { accessSync(path, constants.X_OK); return true; } catch { return false; }
}

function listDir(path: string): string[] {
  try { return readdirSync(path); } catch { return []; }
}

/** A login shell sees the user's real PATH (nvm/fnm/asdf shims live only in shell rc files). */
function loginShellLookup(): Promise<string | null> {
  const shell = process.env.SHELL;
  if (!shell) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(shell, ['-ilc', 'command -v codex'], { timeout: LOGIN_SHELL_TIMEOUT_MS }, (err, stdout) => {
      resolve(err ? null : String(stdout).split('\n').map((l) => l.trim()).find(Boolean) ?? null);
    });
  });
}

export function resolveCodexBinary(explicit: string | null | undefined): Promise<string | null> {
  return locateCodex({
    explicit,
    env: process.env,
    home: homedir(),
    platform: process.platform,
    exists: isExecutable,
    listDir,
    loginShellLookup,
  });
}
