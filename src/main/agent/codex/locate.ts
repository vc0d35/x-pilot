/**
 * A packaged app launched from Finder inherits a bare PATH (`/usr/bin:/bin:/usr/sbin:/sbin`),
 * so a Codex installed via npm, nvm, Homebrew, bun or volta is invisible unless we go looking.
 * Every filesystem and process interaction is injected so this stays unit-testable.
 */
export interface LocateDeps {
  /** The user's `agent.codex.binPath` setting, if any. */
  explicit?: string | null;
  env?: Record<string, string | undefined>;
  home?: string | null;
  platform?: NodeJS.Platform | string;
  /** True when the path exists and is an executable file. */
  exists(path: string): boolean;
  /** Entries of a directory; returns [] when it does not exist. */
  listDir(path: string): string[];
  /** Last resort: ask the user's login shell (`$SHELL -ilc 'command -v codex'`). */
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

/** Directories to probe, in order, after PATH. */
export function candidateDirs(deps: Pick<LocateDeps, 'home' | 'listDir'>): string[] {
  const home = deps.home;
  const dirs = ['/opt/homebrew/bin', '/usr/local/bin'];
  if (!home) return dirs;
  dirs.push(join(home, '.local/bin'), join(home, '.codex/bin'), join(home, '.volta/bin'), join(home, '.bun/bin'));
  const nvmRoot = join(home, '.nvm/versions/node');
  for (const v of deps.listDir(nvmRoot).slice().sort(byVersionDesc)) dirs.push(join(nvmRoot, v, 'bin'));
  dirs.push(join(home, '.fnm/aliases/default/bin'));
  return dirs;
}

/** Order: the explicit setting, every PATH entry, the well-known install dirs, the login shell. */
export async function locateCodex(deps: LocateDeps): Promise<string | null> {
  const platform = String(deps.platform ?? process.platform);
  const bin = BIN_NAME(platform);

  const explicit = deps.explicit?.trim();
  if (explicit && deps.exists(explicit)) return explicit;

  const sep = platform === 'win32' ? ';' : ':';
  const pathEntries = (deps.env?.PATH ?? deps.env?.Path ?? '').split(sep).filter(Boolean);
  for (const dir of [...pathEntries, ...candidateDirs(deps)]) {
    const full = join(dir, bin);
    if (deps.exists(full)) return full;
  }

  const viaShell = (await deps.loginShellLookup?.())?.trim();
  if (viaShell && deps.exists(viaShell)) return viaShell;
  return null;
}
