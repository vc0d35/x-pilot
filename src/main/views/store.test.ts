import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_VIEW_FILE_BYTES } from '../../shared/views';
import { ViewsStore, normalizeViewPath, resolveViewFile } from './store';

const open: ViewsStore[] = [];
const store = (opts: { debounceMs?: number } = {}): ViewsStore => {
  const s = new ViewsStore(join(mkdtempSync(join(tmpdir(), 'xpilot-views-')), 'views'), { debounceMs: 20, ...opts });
  open.push(s);
  return s;
};
const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (done: () => boolean, timeoutMs = 4_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!done() && Date.now() < deadline) await settle(10);
};

afterEach(() => {
  for (const s of open.splice(0)) s.close();
});

describe('normalizeViewPath', () => {
  it('accepts a relative path with an allowed extension', () => {
    expect(normalizeViewPath('index.html')).toBe('index.html');
    expect(normalizeViewPath('assets/app.js')).toBe('assets/app.js');
    expect(normalizeViewPath('/index.html')).toBe('index.html');
  });

  it('refuses anything that could leave the view folder or is not a view file', () => {
    for (const path of [
      '../secrets.json',
      'a/../../b.js',
      '..%2Fx.js',
      '/etc/passwd',
      'C:\\x.js',
      'app.sh',
      'app',
      '.env',
      'a/b/c/d/e.js',
      '',
      'nul\0.js',
    ])
      expect(normalizeViewPath(path), path).toBeNull();
  });
});

describe('resolveViewFile', () => {
  it('puts a file under the view folder', () => {
    expect(resolveViewFile('/profile/views', 'feed', 'assets/app.js')).toBe('/profile/views/feed/assets/app.js');
  });

  it('refuses a name that is not a view name', () => {
    for (const name of ['..', 'Feed', 'a b', '-feed', 'feed/../..', ''])
      expect(resolveViewFile('/profile/views', name, 'index.html'), name).toBeNull();
  });
});

describe('ViewsStore', () => {
  it('creates the view on the first write, privately and with no temp file left behind', () => {
    const s = store();
    expect(s.write('feed', 'index.html', '<h1>hi</h1>')).toMatchObject({ bytes: 11 });
    expect(s.read('feed', 'index.html')).toBe('<h1>hi</h1>');
    expect(statSync(join(s.dir, 'feed', 'index.html')).mode & 0o777).toBe(0o600);
    expect(readdirSync(join(s.dir, 'feed')).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('lists views with their size, file count and whether they can be shown', () => {
    const s = store();
    s.write('feed', 'index.html', '<h1>hi</h1>');
    s.write('feed', 'assets/app.js', 'console.log(1)');
    s.write('draft', 'notes.md', 'later');
    // Not a view name, so it is not a view: a stray folder in the profile is ignored, not listed.
    mkdirSync(join(s.dir, 'Not A View'), { recursive: true });
    expect(s.list()).toEqual([
      { name: 'draft', files: 1, bytes: 5, hasIndex: false },
      { name: 'feed', files: 2, bytes: 25, hasIndex: true },
    ]);
    expect(s.hasIndex('feed')).toBe(true);
    expect(s.hasIndex('draft')).toBe(false);
    expect(s.exists('draft')).toBe(true);
    expect(s.exists('nothing')).toBe(false);
  });

  it('refuses a file that is too big and a view that would grow past its cap', () => {
    const s = store();
    expect(() => s.write('feed', 'big.txt', 'x'.repeat(MAX_VIEW_FILE_BYTES + 1))).toThrow(/larger than/);
    for (let i = 0; i < 10; i++) s.write('feed', `part${i}.txt`, 'x'.repeat(MAX_VIEW_FILE_BYTES));
    expect(() => s.write('feed', 'part10.txt', 'x'.repeat(MAX_VIEW_FILE_BYTES))).toThrow(/more than 5 MB/);
    // Replacing a file that is already there is measured against the rest, not against itself.
    expect(() => s.write('feed', 'part0.txt', 'x'.repeat(MAX_VIEW_FILE_BYTES))).not.toThrow();
  });

  it('refuses a path or a name it cannot contain', () => {
    const s = store();
    expect(() => s.write('feed', '../escape.html', 'x')).toThrow(/Not a usable path/);
    expect(() => s.write('Feed', 'index.html', 'x')).toThrow(/Not a view name/);
    expect(() => s.read('feed', '../../settings.json')).toThrow(/Not a usable path/);
  });

  it('writes through no symlink, and lists none', () => {
    const s = store();
    s.write('feed', 'index.html', 'real');
    const secret = join(s.dir, '..', 'secret.txt');
    writeFileSync(secret, 'private');
    symlinkSync(secret, join(s.dir, 'feed', 'link.txt'));
    expect(() => s.write('feed', 'link.txt', 'overwritten')).toThrow(/not a regular file/);
    expect(readFileSync(secret, 'utf8')).toBe('private');
    expect(s.files('feed')).toEqual(['index.html']);
  });

  it('deletes a whole view and says whether there was one', () => {
    const s = store();
    s.write('feed', 'index.html', 'x');
    expect(s.delete('feed')).toBe(true);
    expect(existsSync(join(s.dir, 'feed'))).toBe(false);
    expect(s.delete('feed')).toBe(false);
  });

  it('reports which view changed on disk, once per burst', async () => {
    const s = store();
    s.write('feed', 'index.html', 'first');
    const changed: string[] = [];
    s.onChange((view) => changed.push(view));
    await settle(200);
    writeFileSync(join(s.dir, 'feed', 'index.html'), 'second');
    writeFileSync(join(s.dir, 'feed', 'app.js'), 'console.log(1)');
    await until(() => changed.length > 0);
    expect(changed).toEqual(['feed']);
  });
});
