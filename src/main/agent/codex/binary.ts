import { homedir } from 'node:os';
import { augmentedPath, isSafeExecutable, listDir, loginShell, spawnEnv, type ExecutableFs, type StatLike } from '../binary';
import { locateCodex } from './locate';

export { augmentedPath, isSafeExecutable };
export type { ExecutableFs, StatLike };

export const CODEX_MISSING_MESSAGE =
  'Codex CLI not found. Install it with `npm i -g @openai/codex`, run `codex login`, or set the binary path in Settings.';

const loginShellLookup = () => loginShell('command -v codex');

export function codexSpawnEnv(binary: string): Promise<NodeJS.ProcessEnv> {
  return spawnEnv(binary);
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
