import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_CSS_BYTES, PAGE_STYLES_HEADER, PageStyles, validateCss } from './styles';

const open: PageStyles[] = [];
const styles = (): PageStyles => {
  const s = new PageStyles(join(mkdtempSync(join(tmpdir(), 'xpilot-')), 'page-styles.css'), { debounceMs: 20 });
  open.push(s);
  return s;
};
const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Watch latency varies with machine load, so a change is waited for rather than slept past. */
const until = async (done: () => boolean, timeoutMs = 5_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!done() && Date.now() < deadline) await settle(10);
};

afterEach(() => {
  for (const s of open.splice(0)) s.close();
});

describe('validateCss', () => {
  it('accepts plain CSS, including a data: URI', () => {
    expect(validateCss('')).toBeNull();
    expect(validateCss('body { background: #000 }\n@media (min-width: 100px) { a { color: red } }')).toBeNull();
    expect(validateCss("div { background-image: url('data:image/svg+xml;base64,AAA') }")).toBeNull();
    expect(validateCss('div { background-image: URL( "DATA:image/png;base64,AAA" ) }')).toBeNull();
  });

  it('rejects @import however it is cased', () => {
    expect(validateCss('@import url("data:text/css,");')).toBe('@import is not allowed');
    expect(validateCss('@IMPORT "x.css";')).toBe('@import is not allowed');
  });

  it('rejects a url() that could reach another host', () => {
    expect(validateCss('a { background: url(https://evil.example/pixel.png) }')).toMatch(/only data: URIs/);
    expect(validateCss("a[href] { background: url('//evil.example/p.png') }")).toMatch(/only data: URIs/);
    expect(validateCss('a { background: url(  "http://evil.example/p.png"  ) }')).toMatch(/only data: URIs/);
    // The first foreign one is named even when a legitimate one comes first.
    expect(validateCss('a { background: url(data:x), url(https://evil.example/p.png) }')).toContain('https://evil.example/p.png');
  });

  it('rejects unbalanced braces', () => {
    expect(validateCss('body { color: red')).toBe('a { is never closed');
    expect(validateCss('body { color: red } }')).toBe('there is a } with no matching {');
  });

  it('rejects a stylesheet over the size cap', () => {
    expect(validateCss('a'.repeat(MAX_CSS_BYTES))).toBeNull();
    expect(validateCss('a'.repeat(MAX_CSS_BYTES + 1))).toMatch(/larger than 64 KB/);
    expect(validateCss('é'.repeat(MAX_CSS_BYTES / 2 + 1))).toMatch(/larger than 64 KB/);
  });
});

describe('PageStyles', () => {
  it('creates the file with its header and returns it', () => {
    const s = styles();
    expect(s.get()).toBe(PAGE_STYLES_HEADER);
    expect(readFileSync(s.path, 'utf8')).toBe(PAGE_STYLES_HEADER);
  });

  it('replaces the whole file and reports the size written', () => {
    const s = styles();
    s.set('a { color: red }');
    expect(s.set('b { color: blue }')).toEqual({ ok: true, bytes: 17 });
    expect(s.get()).toBe('b { color: blue }');
  });

  it('refuses a rejected stylesheet without touching the file', () => {
    const s = styles();
    s.set('a { color: red }');
    expect(s.set('@import "evil.css";')).toEqual({ ok: false, reason: '@import is not allowed' });
    expect(s.get()).toBe('a { color: red }');
  });

  it('resets to the header alone', () => {
    const s = styles();
    s.set('a { color: red }');
    s.reset();
    expect(s.get()).toBe(PAGE_STYLES_HEADER);
  });

  it('notifies on its own writes and on an edit made outside the app', async () => {
    const s = styles();
    const seen: string[] = [];
    s.onChange((css) => seen.push(css));
    s.set('a { color: red }');
    s.reset();
    expect(seen).toEqual(['a { color: red }', PAGE_STYLES_HEADER]);
    // fs.watch misses changes made in the first instants after it starts.
    await settle(200);
    writeFileSync(s.path, 'c { color: green }');
    await until(() => seen.length > 2);
    expect(seen.at(-1)).toBe('c { color: green }');
  });

  it('stops notifying once unsubscribed', () => {
    const s = styles();
    let changes = 0;
    const off = s.onChange(() => changes++);
    off();
    s.set('a {}');
    expect(changes).toBe(0);
  });
});
