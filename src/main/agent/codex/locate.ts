/**
 * A packaged app launched from Finder inherits a bare PATH (`/usr/bin:/bin:/usr/sbin:/sbin`),
 * so a Codex installed via npm, nvm, Homebrew, bun or volta is invisible unless we go looking.
 * The order below is deliberate: what the user configured, then what their environment says,
 * then what their login shell says, and only last the directories we guessed — several of which
 * anything running as the user (or, for Homebrew, a second admin account) can create.
 */
export interface LocateDeps {
  /** The user's `agent.codex.binPath` setting, if any. */
  explicit?: string | null;
  env?: Record<string, string | undefined>;
  home?: string | null;
  platform?: NodeJS.Platform | string;
  /** True when the path is a safe executable: a regular file, owned by the user or root, not group- or world-writable. */
  exists(path: string): boolean;
  /** Entries of a directory; returns [] when it does not exist. */
  listDir(path: string): string[];
  /** Asks the user's login shell (`$SHELL -lc 'command -v codex'`); its answer beats our guesses. */
  loginShellLookup?: () => Promise<string | null>;
}

const BIN_NAME = (platform: string): string => (platform === 'win32' ? 'codex.cmd' : 'codex');

/** Sorts `v22.14.0`-style names newest first; anything unparseable sorts last. */
function byVersionDesc(a: string, b: string): number {
  const parse = (s: string) => (/^v?\d/.test(s) ? s.replace(/^v/, '').split('.').map((n) => Number.parseInt(n, 10) || 0) : null);
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

function join(...parts: string[]): string {
  return parts.join('/').replace(/\/{2,}/g, '/');
}

/** Directories to probe last, system-wide before user-writable ones. */
export function candidateDirs(deps: Pick<LocateDeps, 'home' | 'listDir'>): string[] {
  const home = deps.home;
  const dirs = ['/opt/homebrew/bin', '/usr/local/bin'];
  if (!home) return dirs;
  const nvmRoot = join(home, '.nvm/versions/node');
  for (const v of deps.listDir(nvmRoot).slice().sort(byVersionDesc)) dirs.push(join(nvmRoot, v, 'bin'));
  dirs.push(join(home, '.volta/bin'), join(home, '.fnm/aliases/default/bin'), join(home, '.bun/bin'));
  dirs.push(join(home, '.local/bin'), join(home, '.codex/bin'));
  return dirs;
}

export async function locateCodex(deps: LocateDeps): Promise<string | null> {
  const platform = String(deps.platform ?? process.platform);
  const bin = BIN_NAME(platform);

  const explicit = deps.explicit?.trim();
  if (explicit && deps.exists(explicit)) return explicit;

  const sep = platform === 'win32' ? ';' : ':';
  const pathEntries = (deps.env?.PATH ?? deps.env?.Path ?? '').split(sep).filter(Boolean);
  for (const dir of pathEntries) {
    const full = join(dir, bin);
    if (deps.exists(full)) return full;
  }

  // Before the guessed directories: the login shell reports what the user actually installed.
  const viaShell = (await deps.loginShellLookup?.())?.trim();
  if (viaShell && deps.exists(viaShell)) return viaShell;

  for (const dir of candidateDirs(deps)) {
    const full = join(dir, bin);
    if (deps.exists(full)) return full;
  }
  return null;
}
