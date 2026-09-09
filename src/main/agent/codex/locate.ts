import { byVersionDesc, joinPath as join, locateBinary, type LocateDeps } from '../binary';

export type { LocateDeps };

const BIN_NAME = (platform: string): string => (platform === 'win32' ? 'codex.cmd' : 'codex');

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

export function locateCodex(deps: LocateDeps): Promise<string | null> {
  return locateBinary({ binName: BIN_NAME, candidateDirs }, deps);
}
