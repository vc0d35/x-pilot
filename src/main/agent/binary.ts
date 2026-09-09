import { execFile } from 'node:child_process';
import { accessSync, constants, lstatSync, readdirSync, statSync } from 'node:fs';
import { delimiter, dirname } from 'node:path';

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
 * anyone can write to - is a substitution waiting to happen, not an agent CLI install.
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

export function listDir(path: string): string[] {
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

export function loginShell(command: string): Promise<string | null> {
  const cached = loginShellResults.get(command);
  if (cached) return cached;
  const pending = runLoginShell(command);
  loginShellResults.set(command, pending);
  return pending;
}

/**
 * PATH for the agent child. `codex` is usually a Node script behind `#!/usr/bin/env node`, and an app
 * launched from Finder has no nvm or Homebrew on its PATH, so `node` must be reachable next to the binary.
 */
export function augmentedPath(binary: string, current: string | undefined, loginPath: string | null): string {
  const parts = [dirname(binary), ...(loginPath ?? '').split(delimiter), ...(current ?? '').split(delimiter)];
  return [...new Set(parts.filter(Boolean))].join(delimiter);
}

export async function spawnEnv(binary: string): Promise<NodeJS.ProcessEnv> {
  return { ...process.env, PATH: augmentedPath(binary, process.env.PATH, await loginShell('echo "$PATH"')) };
}

/**
 * A packaged app launched from Finder inherits a bare PATH (`/usr/bin:/bin:/usr/sbin:/sbin`),
 * so a CLI installed via npm, nvm, Homebrew, bun or volta is invisible unless we go looking.
 * The order below is deliberate: what the user configured, then what their environment says,
 * then what their login shell says, and only last the directories we guessed — several of which
 * anything running as the user (or, for Homebrew, a second admin account) can create.
 */
export interface LocateDeps {
  /** The user's `binPath` setting for this provider, if any. */
  explicit?: string | null;
  env?: Record<string, string | undefined>;
  home?: string | null;
  platform?: string;
  /** True when the path is a safe executable: a regular file, owned by the user or root, not group- or world-writable. */
  exists(path: string): boolean;
  /** Entries of a directory; returns [] when it does not exist. */
  listDir(path: string): string[];
  /** Asks the user's login shell (`$SHELL -lc 'command -v <bin>'`); its answer beats our guesses. */
  loginShellLookup?: () => Promise<string | null>;
}

/** What differs between one CLI and the next: its file name, and where it is usually installed. */
export interface LocateSpec {
  binName(platform: string): string;
  candidateDirs(deps: Pick<LocateDeps, 'home' | 'listDir'>): string[];
}

export function joinPath(...parts: string[]): string {
  return parts.join('/').replace(/\/{2,}/g, '/');
}

/** Sorts `v22.14.0`-style names newest first; anything unparseable sorts last. */
export function byVersionDesc(a: string, b: string): number {
  const parse = (s: string) =>
    /^v?\d/.test(s)
      ? s
          .replace(/^v/, '')
          .split('.')
          .map((n) => Number.parseInt(n, 10) || 0)
      : null;
  const pa = parse(a);
  const pb = parse(b);
  if (!pa && !pb) return a < b ? 1 : -1;
  if (!pa) return 1;
  if (!pb) return -1;
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pb[i] ?? 0) - (pa[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export async function locateBinary(spec: LocateSpec, deps: LocateDeps): Promise<string | null> {
  const platform = String(deps.platform ?? process.platform);
  const bin = spec.binName(platform);

  const explicit = deps.explicit?.trim();
  if (explicit && deps.exists(explicit)) return explicit;

  const sep = platform === 'win32' ? ';' : ':';
  const pathEntries = (deps.env?.PATH ?? deps.env?.Path ?? '').split(sep).filter(Boolean);
  for (const dir of pathEntries) {
    const full = joinPath(dir, bin);
    if (deps.exists(full)) return full;
  }

  // Before the guessed directories: the login shell reports what the user actually installed.
  const viaShell = (await deps.loginShellLookup?.())?.trim();
  if (viaShell && deps.exists(viaShell)) return viaShell;

  for (const dir of spec.candidateDirs(deps)) {
    const full = joinPath(dir, bin);
    if (deps.exists(full)) return full;
  }
  return null;
}
