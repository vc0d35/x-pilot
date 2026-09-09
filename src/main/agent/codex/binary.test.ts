import { describe, it, expect, vi } from 'vitest';

const shellCalls = vi.hoisted(() => [] as Array<{ file: string; args: string[]; opts: Record<string, unknown> }>);
vi.mock('node:child_process', () => ({
  execFile: (file: string, args: string[], opts: Record<string, unknown>, cb: (e: null, out: string) => void) => {
    shellCalls.push({ file, args, opts });
    cb(null, '/opt/homebrew/bin:/usr/bin\n');
  },
}));

import { augmentedPath, codexSpawnEnv, isSafeExecutable, type ExecutableFs, type StatLike } from './binary';

describe('augmentedPath', () => {
  it('puts the binary directory first, then the login shell PATH, then the current PATH, without duplicates', () => {
    expect(augmentedPath('/Users/me/.nvm/versions/node/v24/bin/codex', '/usr/bin:/bin', '/opt/homebrew/bin:/usr/bin')).toBe(
      '/Users/me/.nvm/versions/node/v24/bin:/opt/homebrew/bin:/usr/bin:/bin',
    );
  });
  it('copes with a missing login shell PATH and an empty current PATH', () => {
    expect(augmentedPath('/usr/local/bin/codex', undefined, null)).toBe('/usr/local/bin');
  });
});

const ME = 501;
type Entry = { uid?: number; mode?: number; file?: boolean; link?: string };

/** A filesystem of entries with the ownership and mode bits the safety check reads. */
function fakeFs(entries: Record<string, Entry>): ExecutableFs {
  const stat = (path: string, follow: boolean): StatLike => {
    const e = entries[path];
    if (!e) throw new Error(`ENOENT ${path}`);
    if (follow && e.link) return stat(e.link, true);
    return { uid: e.uid ?? ME, mode: e.mode ?? 0o755, isFile: () => e.file !== false && !e.link, isSymbolicLink: () => Boolean(e.link) };
  };
  return {
    lstat: (p) => stat(p, false),
    stat: (p) => stat(p, true),
    isExecutable: (p) => p in entries,
    uid: () => ME,
  };
}

describe('isSafeExecutable', () => {
  const dir = { '/opt/bin': { file: false, mode: 0o755 } };

  it('accepts a regular file owned by the user or by root in a sane directory', () => {
    expect(isSafeExecutable('/opt/bin/codex', fakeFs({ ...dir, '/opt/bin/codex': {} }))).toBe(true);
    expect(isSafeExecutable('/opt/bin/codex', fakeFs({ ...dir, '/opt/bin/codex': { uid: 0, mode: 0o755 } }))).toBe(true);
  });

  it('rejects a file another user owns', () => {
    expect(isSafeExecutable('/opt/bin/codex', fakeFs({ ...dir, '/opt/bin/codex': { uid: 502 } }))).toBe(false);
  });

  it('rejects a group- or world-writable file', () => {
    expect(isSafeExecutable('/opt/bin/codex', fakeFs({ ...dir, '/opt/bin/codex': { mode: 0o775 } }))).toBe(false);
    expect(isSafeExecutable('/opt/bin/codex', fakeFs({ ...dir, '/opt/bin/codex': { mode: 0o777 } }))).toBe(false);
  });

  it('rejects a file in a world-writable directory', () => {
    expect(isSafeExecutable('/tmp/codex', fakeFs({ '/tmp': { file: false, mode: 0o777 }, '/tmp/codex': {} }))).toBe(false);
  });

  it('rejects what is not a regular file, and what is not there at all', () => {
    expect(isSafeExecutable('/opt/bin/codex', fakeFs({ ...dir, '/opt/bin/codex': { file: false } }))).toBe(false);
    expect(isSafeExecutable('/opt/bin/codex', fakeFs(dir))).toBe(false);
  });

  it('follows a symlink to its target and judges both ends', () => {
    const target = { '/opt/bin/real': {} };
    expect(
      isSafeExecutable('/opt/bin/codex', fakeFs({ ...dir, ...target, '/opt/bin/codex': { link: '/opt/bin/real', mode: 0o777 } })),
    ).toBe(true);
    expect(isSafeExecutable('/opt/bin/codex', fakeFs({ ...dir, ...target, '/opt/bin/codex': { link: '/opt/bin/real', uid: 502 } }))).toBe(
      false,
    );
    expect(
      isSafeExecutable('/opt/bin/codex', fakeFs({ ...dir, '/opt/bin/real': { uid: 502 }, '/opt/bin/codex': { link: '/opt/bin/real' } })),
    ).toBe(false);
  });
});

describe('the login shell probe', () => {
  it('runs a login shell, not an interactive one, and only once per process', async () => {
    process.env.SHELL = '/bin/zsh';
    const first = await codexSpawnEnv('/opt/homebrew/bin/codex');
    const second = await codexSpawnEnv('/opt/homebrew/bin/codex');
    expect(shellCalls).toHaveLength(1);
    expect(shellCalls[0].file).toBe('/bin/zsh');
    expect(shellCalls[0].args).toEqual(['-lc', 'echo "$PATH"']);
    expect(shellCalls[0].opts.timeout).toBe(3000);
    expect(first.PATH).toBe(second.PATH);
    expect(first.PATH).toContain('/opt/homebrew/bin');
  });
});
