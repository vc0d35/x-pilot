import { describe, it, expect, vi } from 'vitest';
import { locateCodex, candidateDirs } from './locate';

function fakeFs(files: string[], dirs: Record<string, string[]> = {}) {
  return {
    exists: (p: string) => files.includes(p),
    listDir: (p: string) => dirs[p] ?? [],
  };
}

const base = { home: '/Users/x', platform: 'darwin' as const, env: { PATH: '/usr/bin:/bin' } };

describe('locateCodex', () => {
  it('prefers the explicit setting when it exists', async () => {
    const fs = fakeFs(['/opt/custom/codex', '/usr/local/bin/codex']);
    await expect(locateCodex({ ...base, ...fs, explicit: '/opt/custom/codex' })).resolves.toBe('/opt/custom/codex');
  });

  it('ignores an explicit setting that does not exist and falls through', async () => {
    const fs = fakeFs(['/usr/local/bin/codex']);
    await expect(locateCodex({ ...base, ...fs, explicit: '/gone/codex' })).resolves.toBe('/usr/local/bin/codex');
  });

  it('finds it on PATH before the well-known directories', async () => {
    const fs = fakeFs(['/usr/bin/codex', '/opt/homebrew/bin/codex']);
    await expect(locateCodex({ ...base, ...fs })).resolves.toBe('/usr/bin/codex');
  });

  it('finds a Homebrew install when PATH is the bare Finder PATH', async () => {
    const fs = fakeFs(['/opt/homebrew/bin/codex']);
    await expect(locateCodex({ ...base, ...fs, env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' } })).resolves.toBe('/opt/homebrew/bin/codex');
  });

  it('finds installs under the home directory', async () => {
    for (const p of ['/Users/x/.local/bin/codex', '/Users/x/.codex/bin/codex', '/Users/x/.volta/bin/codex', '/Users/x/.bun/bin/codex', '/Users/x/.fnm/aliases/default/bin/codex']) {
      await expect(locateCodex({ ...base, ...fakeFs([p]) })).resolves.toBe(p);
    }
  });

  it('picks the newest nvm node version', async () => {
    const dirs = { '/Users/x/.nvm/versions/node': ['v18.20.0', 'v22.3.1', 'v20.11.0'] };
    const fs = fakeFs(['/Users/x/.nvm/versions/node/v18.20.0/bin/codex', '/Users/x/.nvm/versions/node/v22.3.1/bin/codex'], dirs);
    await expect(locateCodex({ ...base, ...fs })).resolves.toBe('/Users/x/.nvm/versions/node/v22.3.1/bin/codex');
    expect(candidateDirs({ home: '/Users/x', listDir: fs.listDir }).filter((d) => d.includes('.nvm')))
      .toEqual(['/Users/x/.nvm/versions/node/v22.3.1/bin', '/Users/x/.nvm/versions/node/v20.11.0/bin', '/Users/x/.nvm/versions/node/v18.20.0/bin']);
  });

  it('asks the login shell last and only when nothing else matched', async () => {
    const loginShellLookup = vi.fn(async () => '/Users/x/.asdf/shims/codex\n');
    const fs = fakeFs(['/Users/x/.asdf/shims/codex']);
    await expect(locateCodex({ ...base, ...fs, loginShellLookup })).resolves.toBe('/Users/x/.asdf/shims/codex');
    expect(loginShellLookup).toHaveBeenCalledTimes(1);

    loginShellLookup.mockClear();
    await expect(locateCodex({ ...base, ...fakeFs(['/usr/bin/codex']), loginShellLookup })).resolves.toBe('/usr/bin/codex');
    expect(loginShellLookup).not.toHaveBeenCalled();
  });

  it('returns null when codex is nowhere', async () => {
    await expect(locateCodex({ ...base, ...fakeFs([]) })).resolves.toBeNull();
    await expect(locateCodex({ ...base, ...fakeFs([]), loginShellLookup: async () => null })).resolves.toBeNull();
    await expect(locateCodex({ ...base, ...fakeFs([]), loginShellLookup: async () => '/not/there/codex' })).resolves.toBeNull();
  });

  it('works without a home directory and on win32', async () => {
    await expect(locateCodex({ ...base, ...fakeFs(['/usr/local/bin/codex']), home: null })).resolves.toBe('/usr/local/bin/codex');
    const win = fakeFs(['C:/npm/codex.cmd']);
    await expect(locateCodex({ ...win, home: null, platform: 'win32', env: { PATH: 'C:/npm;C:/windows' } })).resolves.toBe('C:/npm/codex.cmd');
  });
});
