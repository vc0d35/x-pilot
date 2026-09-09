import { WatchedFile } from './file';

export const PAGE_STYLES_FILE = 'page-styles.css';

export const PAGE_STYLES_HEADER = `/* XPilot page styles.
 *
 * Plain CSS applied to the x.com page in the app window. Edit it here or ask the agent to
 * restyle the page; either way it is re-applied as soon as the file is saved.
 * The hidden windows XPilot reads in are never styled, so a rule cannot hide content from a tool.
 * A rule may not name anything outside the page: no imports, no foreign hosts, and pictures only as
 * inline data: URIs, so a rule cannot call out. The same check runs over what you write here, and
 * a file that fails it is left alone rather than applied.
 */
`;

export const MAX_CSS_BYTES = 64 * 1024;

/** Function-shaped ways CSS names a resource, none of which a page-restyling sheet needs. */
const BANNED_TOKENS = ['@import', '@namespace', '@font-face', 'image-set(', '-webkit-image-set(', 'element(', 'cross-fade(', '://', '//'];

/** Comments cannot split a CSS token, so removing them first is what makes a substring scan sound. */
export function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/** Why this stylesheet was refused, or null if it is fine to apply. */
export function validateCss(css: string): string | null {
  if (Buffer.byteLength(css) > MAX_CSS_BYTES) return `the stylesheet is larger than ${MAX_CSS_BYTES / 1024} KB`;
  const text = stripCssComments(css);
  // An escape is the one way a CSS token can spell itself differently from how it reads
  // (`u\72l(` is `url(`), and nothing a restyling sheet needs is written with one.
  if (text.includes('\\')) return 'a backslash escape is not allowed';
  const lower = text.toLowerCase();
  for (const token of BANNED_TOKENS) {
    if (lower.includes(token)) return `${token} is not allowed`;
  }
  const foreign = firstForeignUrl(text);
  if (foreign !== null) return `url(${foreign}) is not allowed; only data: URIs are`;
  let depth = 0;
  for (const ch of text) {
    if (ch === '{') depth++;
    else if (ch === '}' && --depth < 0) return 'there is a } with no matching {';
  }
  if (depth > 0) return 'a { is never closed';
  return null;
}

function firstForeignUrl(css: string): string | null {
  const lower = css.toLowerCase();
  for (let at = lower.indexOf('url('); at !== -1; at = lower.indexOf('url(', at + 4)) {
    const end = css.indexOf(')', at + 4);
    const arg = (end === -1 ? css.slice(at + 4) : css.slice(at + 4, end))
      .trim()
      .replace(/^['"]|['"]$/g, '')
      .trim();
    if (!arg.toLowerCase().startsWith('data:')) return arg.slice(0, 60);
  }
  return null;
}

export type StylesWriteResult = { ok: true; bytes: number } | { ok: false; reason: string };

/**
 * The user's stylesheet for the X page: `<userData>/page-styles.css`, read, replaced and watched.
 * The applied sheet is held in memory and only ever replaced by text that passed `validateCss`, so
 * the synchronous startup reply is a field read and a hand-edited file that would not be accepted
 * from the agent is not applied either — the reason is kept in `lastError` for Settings to show.
 */
export class PageStyles {
  private readonly file: WatchedFile;
  private readonly listeners = new Set<(css: string) => void>();
  private applied: string | null = null;
  private error: string | null = null;

  constructor(path: string, opts: { debounceMs?: number } = {}) {
    this.file = new WatchedFile(path, { header: PAGE_STYLES_HEADER, debounceMs: opts.debounceMs });
    this.file.onChange(() => this.refresh());
  }

  get path(): string {
    return this.file.path;
  }

  /** Why the file on disk is not what is applied, or null when they agree. */
  get lastError(): string | null {
    return this.error;
  }

  get(): string {
    if (this.applied === null) this.load();
    return this.applied ?? '';
  }

  /** Replaces the whole stylesheet, or refuses it with a reason the agent can act on. */
  set(css: string): StylesWriteResult {
    const reason = validateCss(css);
    if (reason) return { ok: false, reason };
    this.file.write(css);
    this.error = null;
    this.applied = css;
    this.emit();
    return { ok: true, bytes: Buffer.byteLength(css) };
  }

  reset(): void {
    this.file.write(PAGE_STYLES_HEADER);
    this.error = null;
    this.applied = PAGE_STYLES_HEADER;
    this.emit();
  }

  onChange(cb: (css: string) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  close(): void {
    this.file.close();
    this.listeners.clear();
  }

  /** A change on disk only reaches the page once it passes the same check the agent's writes do. */
  private refresh(): void {
    const before = this.applied;
    this.load();
    if (this.applied !== before) this.emit();
  }

  private load(): void {
    let text: string;
    try {
      text = this.file.read();
    } catch (err) {
      this.setError(err instanceof Error ? err.message : String(err));
      return;
    }
    const reason = validateCss(text);
    if (reason) {
      this.setError(reason);
      return;
    }
    this.error = null;
    this.applied = text;
  }

  /** The last sheet that was accepted stays on the page; on the very first read there is none. */
  private setError(reason: string): void {
    if (this.error !== reason) console.warn(`[xpilot] ${this.file.path} is not applied: ${reason}`);
    this.error = reason;
    this.applied ??= '';
  }

  private emit(): void {
    const css = this.get();
    for (const cb of [...this.listeners]) cb(css);
  }
}
