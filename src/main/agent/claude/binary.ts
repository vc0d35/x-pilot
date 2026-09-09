import { homedir } from 'node:os';
import {
  isSafeExecutable,
  joinPath as join,
  listDir,
  locateBinary,
  loginShell,
  missingBinaryMessage,
  spawnEnv,
  type LocateDeps,
} from '../binary';

export const CLAUDE_MISSING_MESSAGE =
  'Claude Code not found. Install it from claude.com/code, run `claude` once to log in, or set the binary path in Settings.';

export const claudeMissingMessage = (explicit: string | null | undefined): string =>
  missingBinaryMessage('Claude Code', CLAUDE_MISSING_MESSAGE, explicit);

const BIN_NAME = (platform: string): string => (platform === 'win32' ? 'claude.cmd' : 'claude');

/** Where the Claude Code installer puts the binary, system-wide before user-writable. */
export function candidateDirs(deps: Pick<LocateDeps, 'home' | 'listDir'>): string[] {
  const dirs = ['/opt/homebrew/bin', '/usr/local/bin'];
  if (deps.home) dirs.push(join(deps.home, '.local/bin'));
  return dirs;
}

export function locateClaude(deps: LocateDeps): Promise<string | null> {
  return locateBinary({ binName: BIN_NAME, candidateDirs }, deps);
}

const loginShellLookup = () => loginShell('command -v claude');

export function claudeSpawnEnv(binary: string): Promise<NodeJS.ProcessEnv> {
  return spawnEnv(binary);
}

export function resolveClaudeBinary(explicit: string | null | undefined): Promise<string | null> {
  return locateClaude({
    explicit,
    env: process.env,
    home: homedir(),
    platform: process.platform,
    exists: (path) => isSafeExecutable(path),
    listDir,
    loginShellLookup,
  });
}
