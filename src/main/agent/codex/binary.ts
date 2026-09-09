import { execFile } from 'node:child_process';
import { accessSync, constants, lstatSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname } from 'node:path';
import { locateCodex } from './locate';

export const CODEX_MISSING_MESSAGE =
  'Codex CLI not found. Install it with `npm i -g @openai/codex`, run `codex login`, or set the binary path in Settings.';

const LOGIN_SHELL_TIMEOUT_MS = 3000;

/** The parts of a stat entry the safety check reads. */
export interface StatLike {
  uid: number;
  mode: number;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

export interface ExecutableFs {
  /** Stats the entry itself, without following a symlink. Throws when it does not exist. */
  lstat(path: string): StatLike;
  /** Stats what the path resolves to. Throws when it does not exist. */
  stat(path: string): StatLike;
  isExecutable(path: string): boolean;
  uid(): number;
}

const nodeFs: ExecutableFs = {
  lstat: lstatSync,
  stat: statSync,
  isExecutable: (path) => {
    try {
      accessSync(path, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  },
  uid: () => process.getuid?.() ?? -1,
};

/**
 * Whether spawning this path is safe. XPilot runs the result as itself with the full parent
 * environment, so a file anyone but the user or root can rewrite - or one sitting in a directory
 * anyone can write to - is a substitution waiting to happen, not a Codex install.
 */
export function isSafeExecutable(path: string, fs: ExecutableFs = nodeFs): boolean {
  const me = fs.uid();
  const ownedByUserOrRoot = (st: StatLike) => st.uid === 0 || (me >= 0 && st.uid === me);
  const notSharedWritable = (st: StatLike) => (st.mode & 0o022) === 0;
  let link: StatLike;
  let file: StatLike;
  let parent: StatLike;
  try {
    link = fs.lstat(path);
    file = fs.stat(path);
    parent = fs.stat(dirname(path));
  } catch {
    return false;
  }
  if (!file.isFile() || !fs.isExecutable(path)) return false;
  if (!ownedByUserOrRoot(link) || !ownedByUserOrRoot(file)) return false;
  // Symlink mode bits are not enforced by the kernel; only the target's matter.
  if (!link.isSymbolicLink() && !notSharedWritable(link)) return false;
  if (!notSharedWritable(file)) return false;
  return (parent.mode & 0o002) === 0;
}

function listDir(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

/**
 * A login shell sees the user's real PATH (nvm/fnm/asdf shims live only in shell startup files).
 * `-lc`, not `-ilc`: a login shell reads the profile, an interactive one also reads `~/.zshrc`,
 * which is a much larger surface to run inside the app for the sake of one PATH lookup.
 */
function runLoginShell(command: string): Promise<string | null> {
  const shell = process.env.SHELL;
  if (!shell) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(shell, ['-lc', command], { timeout: LOGIN_SHELL_TIMEOUT_MS, killSignal: 'SIGKILL' }, (err, stdout) => {
      resolve(
        err
          ? null
          : (String(stdout)
              .split('\n')
              .map((l) => l.trim())
              .find(Boolean) ?? null),
      );
    });
  });
}

/** One shell per command for the life of the process: startup files should not run on every agent start. */
const loginShellResults = new Map<string, Promise<string | null>>();

function loginShell(command: string): Promise<string | null> {
  const cached = loginShellResults.get(command);
  if (cached) return cached;
  const pending = runLoginShell(command);
  loginShellResults.set(command, pending);
  return pending;
}

const loginShellLookup = () => loginShell('command -v codex');

/**
 * PATH for the codex child. `codex` is usually a Node script behind `#!/usr/bin/env node`, and an app
 * launched from Finder has no nvm or Homebrew on its PATH, so `node` must be reachable next to the binary.
 */
export function augmentedPath(binary: string, current: string | undefined, loginPath: string | null): string {
  const parts = [dirname(binary), ...(loginPath ?? '').split(delimiter), ...(current ?? '').split(delimiter)];
  return [...new Set(parts.filter(Boolean))].join(delimiter);
}

export async function codexSpawnEnv(binary: string): Promise<NodeJS.ProcessEnv> {
  return { ...process.env, PATH: augmentedPath(binary, process.env.PATH, await loginShell('echo "$PATH"')) };
}

export function resolveCodexBinary(explicit: string | null | undefined): Promise<string | null> {
  return locateCodex({
    explicit,
    env: process.env,
    home: homedir(),
    platform: process.platform,
    exists: (path) => isSafeExecutable(path),
    listDir,
    loginShellLookup,
  });
}
