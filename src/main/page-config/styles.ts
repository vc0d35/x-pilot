import { WatchedFile } from './file';

export const PAGE_STYLES_FILE = 'page-styles.css';

export const PAGE_STYLES_HEADER = `/* XPilot page styles.
 *
 * Plain CSS applied to the x.com page in the app window. Edit it here or ask the agent to
 * restyle the page; either way it is re-applied as soon as the file is saved.
 * The hidden windows XPilot reads in are never styled, so a rule cannot hide content from a tool.
 * @import is not allowed and url() may only reference a data: URI, so a rule cannot call out.
 */
`;

export const MAX_CSS_BYTES = 64 * 1024;

/** Why this stylesheet was refused, or null if it is fine to write. */
export function validateCss(css: string): string | null {
  if (Buffer.byteLength(css) > MAX_CSS_BYTES) return `the stylesheet is larger than ${MAX_CSS_BYTES / 1024} KB`;
  // Checked on the raw text, so a rule cannot be smuggled past in what looks like a comment.
  if (/@import/i.test(css)) return '@import is not allowed';
  const foreign = firstForeignUrl(css);
  if (foreign !== null) return `url(${foreign}) is not allowed; only data: URIs are`;
  let depth = 0;
  for (const ch of css) {
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

/** The user's stylesheet for the X page: `<userData>/page-styles.css`, read, replaced and watched. */
export class PageStyles {
  private readonly file: WatchedFile;
  private readonly listeners = new Set<(css: string) => void>();

  constructor(path: string, opts: { debounceMs?: number } = {}) {
    this.file = new WatchedFile(path, { header: PAGE_STYLES_HEADER, debounceMs: opts.debounceMs });
    this.file.onChange(() => this.emit());
  }

  get path(): string {
    return this.file.path;
  }

  get(): string {
    return this.file.read();
  }

  /** Replaces the whole stylesheet, or refuses it with a reason the agent can act on. */
  set(css: string): StylesWriteResult {
    const reason = validateCss(css);
    if (reason) return { ok: false, reason };
    this.file.write(css);
    this.emit();
    return { ok: true, bytes: Buffer.byteLength(css) };
  }

  reset(): void {
    this.file.write(PAGE_STYLES_HEADER);
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

  private emit(): void {
    const css = this.get();
    for (const cb of [...this.listeners]) cb(css);
  }
}
