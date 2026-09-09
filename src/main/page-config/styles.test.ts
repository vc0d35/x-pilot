import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_CSS_BYTES, PAGE_STYLES_HEADER, PageStyles, validateCss } from './styles';

const open: PageStyles[] = [];
const styles = (dir = mkdtempSync(join(tmpdir(), 'xpilot-'))): PageStyles => {
  const s = new PageStyles(join(dir, 'page-styles.css'), { debounceMs: 20 });
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

  it('accepts the header it writes the file with, and a header plus a rule', () => {
    expect(validateCss(PAGE_STYLES_HEADER)).toBeNull();
    expect(validateCss(`${PAGE_STYLES_HEADER}\nbody { font-size: 18px }\n`)).toBeNull();
  });

  it('rejects @import however it is cased', () => {
    expect(validateCss('@import url("data:text/css,");')).toBe('@import is not allowed');
    expect(validateCss('@IMPORT "x.css";')).toBe('@import is not allowed');
  });

  it('rejects a url() that could reach another host', () => {
    expect(validateCss('a { background: url(https://evil.example/pixel.png) }')).toMatch(/not allowed/);
    expect(validateCss("a[href] { background: url('//evil.example/p.png') }")).toMatch(/not allowed/);
    expect(validateCss('a { background: url(  "http://evil.example/p.png"  ) }')).toMatch(/not allowed/);
    // A relative path names no host but still leaves the sheet: only data: is allowed.
    expect(validateCss('a { background: url(pixel.png) }')).toMatch(/only data: URIs/);
  });

  // Every one of these was accepted by the first version of this check and fetched in the
  // security review's live probe; each is a different way of naming a resource.
  it('rejects the ways CSS names a resource that are not url()', () => {
    expect(validateCss('body { background-image: image-set("https://evil.example/A" 1x) }')).toBe('image-set( is not allowed');
    expect(validateCss('body { background-image: -webkit-image-set("https://evil.example/B" 1x) }')).toMatch(/not allowed/);
    expect(validateCss('body { background: cross-fade(url(a.png), url(b.png)) }')).toBe('cross-fade( is not allowed');
    expect(validateCss('body { background: element(#live) }')).toBe('element( is not allowed');
    expect(validateCss('@font-face { font-family: x; src: "https://evil.example/f.woff2" }')).toBe('@font-face is not allowed');
    expect(validateCss('@namespace "https://evil.example/ns";')).toBe('@namespace is not allowed');
  });

  it('rejects an escape, which is the one way a token can spell itself differently', () => {
    expect(validateCss('body { background: u\\72l("https://evil.example/C") }')).toBe('a backslash escape is not allowed');
    expect(validateCss('@\\69mport "https://evil.example/x.css";')).toBe('a backslash escape is not allowed');
    expect(validateCss('div::after { content: "\\201C" }')).toBe('a backslash escape is not allowed');
  });

  it('strips comments first, so nothing hides in one and nothing is split by one', () => {
    expect(validateCss('div { background: ur/**/l(https://evil.example/x) }')).toMatch(/not allowed/);
    expect(validateCss('/* @import is fine to talk about */ body { color: red }')).toBeNull();
    expect(validateCss('/* } */ div { color: red }')).toBeNull();
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

  it('round-trips what it reads: the header it wrote can be written straight back', () => {
    const s = styles();
    expect(s.set(s.get())).toMatchObject({ ok: true });
    expect(s.set(`${s.get()}\nbody { font-size: 18px }\n`)).toMatchObject({ ok: true });
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

  it('does not apply a hand-edited stylesheet that fails the check, and says why', async () => {
    const s = styles();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    s.set('a { color: red }');
    const seen: string[] = [];
    s.onChange((css) => seen.push(css));
    await settle(200);
    writeFileSync(s.path, 'body { background: url(https://evil.example/leak) }');
    await until(() => s.lastError !== null);
    expect(s.lastError).toMatch(/not allowed/);
    expect(s.get()).toBe('a { color: red }');
    expect(seen).toEqual([]);
    warn.mockRestore();
  });

  it('ignores a symlink where the file should be, so nothing else on disk is applied or read back', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xpilot-'));
    const secret = join(dir, 'secret.txt');
    writeFileSync(secret, 'a { color: red } /* private */');
    symlinkSync(secret, join(dir, 'page-styles.css'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(styles(dir).get()).toBe(PAGE_STYLES_HEADER);
    warn.mockRestore();
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
