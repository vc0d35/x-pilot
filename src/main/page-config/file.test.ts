import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WatchedFile } from './file';

const open: WatchedFile[] = [];
const watched = (opts: { header?: string; debounceMs?: number } = {}): WatchedFile => {
  const file = new WatchedFile(join(mkdtempSync(join(tmpdir(), 'xpilot-')), 'nested', 'config.css'), { debounceMs: 20, ...opts });
  open.push(file);
  return file;
};
const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** fs.watch misses changes made in the first instants after it starts, so tests subscribe and wait. */
const watching = async (file: WatchedFile, cb: () => void): Promise<() => void> => {
  const off = file.onChange(cb);
  await settle(200);
  return off;
};
/** Watch latency varies with machine load, so a change is waited for rather than slept past. */
const until = async (done: () => boolean, timeoutMs = 4_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!done() && Date.now() < deadline) await settle(10);
};

afterEach(() => {
  for (const file of open.splice(0)) file.close();
});

describe('WatchedFile', () => {
  it('creates the file with its header on the first read', () => {
    const file = watched({ header: '/* header */\n' });
    expect(file.read()).toBe('/* header */\n');
    expect(readFileSync(file.path, 'utf8')).toBe('/* header */\n');
    expect(file.read()).toBe('/* header */\n');
  });

  it('writes privately and atomically, leaving no temp file behind', () => {
    const file = watched();
    file.write('body { color: red }');
    expect(readFileSync(file.path, 'utf8')).toBe('body { color: red }');
    expect(statSync(file.path).mode & 0o777).toBe(0o600);
    expect(readdirSync(join(file.path, '..')).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('replaces the whole file on a second write', () => {
    const file = watched();
    file.write('a { color: red }');
    file.write('b { color: blue }');
    expect(file.read()).toBe('b { color: blue }');
  });

  it('reports an edit made outside the app, once per burst', async () => {
    const file = watched();
    file.write('a {}');
    let changes = 0;
    await watching(file, () => changes++);
    writeFileSync(file.path, 'b {}');
    writeFileSync(file.path, 'c {}');
    await until(() => changes > 0);
    await settle(100);
    expect(changes).toBe(1);
    expect(file.read()).toBe('c {}');
  });

  it('does not report our own write', async () => {
    const file = watched();
    let changes = 0;
    await watching(file, () => changes++);
    file.write('a {}');
    await settle(300);
    expect(changes).toBe(0);
  });

  it('reports the file being deleted', async () => {
    const file = watched({ header: '/* h */\n' });
    file.write('a {}');
    let changes = 0;
    await watching(file, () => changes++);
    rmSync(file.path);
    await until(() => changes > 0);
    expect(changes).toBe(1);
    expect(file.read()).toBe('/* h */\n');
  });

  it('stops watching once closed', async () => {
    const file = watched();
    file.write('a {}');
    let changes = 0;
    const off = await watching(file, () => changes++);
    off();
    writeFileSync(file.path, 'b {}');
    await settle(300);
    expect(changes).toBe(0);
    file.close();
    expect(existsSync(file.path)).toBe(true);
  });
});
