import { renameSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { WatchedFile } from './file';
import { SELECTOR_DEFAULTS, SELECTOR_DESCRIPTIONS, type SelectorKey } from '../../shared/selectors';

export const SELECTORS_FILE = 'selectors.json';
export const MAX_SELECTOR_LENGTH = 512;

/** JSON carries no comments, so the explanation is a field. It is rewritten with every save. */
export const SELECTORS_COMMENT =
  'XPilot selector overrides. Each entry replaces one CSS selector the page adapter uses to read x.com, in every X window. ' +
  'replacedDefault is the selector XPilot shipped when the override was written: if a later version ships a different default, ' +
  'the override is kept and reported as stale, so nothing you fixed is dropped and nothing new is silently ignored. ' +
  'Keys with no entry always follow the shipped default; delete an entry to go back to it.';

const EntrySchema = z.object({ selector: z.string(), replacedDefault: z.string() });
const FileSchema = z.object({
  _comment: z.string().optional(),
  appVersion: z.string().optional(),
  overrides: z.record(z.string(), EntrySchema).default({}),
});
type SelectorsFile = z.infer<typeof FileSchema>;

export type SelectorStatus = 'default' | 'overridden' | 'stale';

export interface SelectorInfo {
  key: SelectorKey;
  description: string;
  default: string;
  effective: string;
  status: SelectorStatus;
}

export type SelectorSetResult = { ok: true; previous: string; status: SelectorStatus } | { ok: false; reason: string };

export interface SelectorCounts {
  overridden: number;
  stale: number;
}

/**
 * The user's selector overrides: `<userData>/selectors.json`, read, replaced and watched. Only
 * overridden keys are stored, each with the default it replaced, so a new version's updated defaults
 * flow through for every key nobody has touched.
 */
export class SelectorOverrides {
  readonly appVersion: string;
  private readonly file: WatchedFile;
  private readonly defaults: Record<SelectorKey, string>;
  private readonly descriptions: Record<SelectorKey, string>;
  private readonly listeners = new Set<(overrides: Partial<Record<SelectorKey, string>>) => void>();

  constructor(
    path: string,
    opts: {
      appVersion?: string;
      /** Injectable so a test can ship a different default and watch an override turn stale. */
      defaults?: Record<SelectorKey, string>;
      descriptions?: Record<SelectorKey, string>;
      debounceMs?: number;
    } = {},
  ) {
    this.defaults = opts.defaults ?? SELECTOR_DEFAULTS;
    this.descriptions = opts.descriptions ?? SELECTOR_DESCRIPTIONS;
    this.appVersion = opts.appVersion ?? '';
    this.file = new WatchedFile(path, { header: this.render({ overrides: {} }), debounceMs: opts.debounceMs });
    this.file.onChange(() => this.emit());
  }

  get path(): string {
    return this.file.path;
  }

  /** The overrides the preload applies over its shipped defaults: only the keys we know. */
  overrides(): Partial<Record<SelectorKey, string>> {
    const out: Partial<Record<SelectorKey, string>> = {};
    for (const [key, entry] of Object.entries(this.read().overrides)) {
      if (this.isKey(key)) out[key] = entry.selector;
    }
    return out;
  }

  effective(): Record<SelectorKey, string> {
    return { ...this.defaults, ...this.overrides() };
  }

  list(): SelectorInfo[] {
    const stored = this.read().overrides;
    return this.keys().map((key) => {
      const entry = stored[key];
      return {
        key,
        description: this.descriptions[key],
        default: this.defaults[key],
        effective: entry ? entry.selector : this.defaults[key],
        status: this.statusOf(key, entry),
      };
    });
  }

  counts(): SelectorCounts {
    const info = this.list();
    return { overridden: info.filter((i) => i.status !== 'default').length, stale: info.filter((i) => i.status === 'stale').length };
  }

  /** Records the current default as the one this override replaces, which is what makes it go stale later. */
  set(key: string, selector: string): SelectorSetResult {
    if (!this.isKey(key)) return { ok: false, reason: `there is no selector called "${key}" (known keys: ${this.keys().join(', ')})` };
    const trimmed = selector.trim();
    if (trimmed.length === 0) return { ok: false, reason: 'the selector is empty' };
    if (trimmed.length > MAX_SELECTOR_LENGTH) return { ok: false, reason: `the selector is longer than ${MAX_SELECTOR_LENGTH} characters` };
    const data = this.read();
    const previous = data.overrides[key]?.selector ?? this.defaults[key];
    data.overrides[key] = { selector: trimmed, replacedDefault: this.defaults[key] };
    this.save(data);
    return { ok: true, previous, status: this.statusOf(key, data.overrides[key]) };
  }

  /** True when there was an override to remove; an unknown key is never overridden. */
  reset(key: string): boolean {
    const data = this.read();
    if (!this.isKey(key) || !data.overrides[key]) return false;
    delete data.overrides[key];
    this.save(data);
    return true;
  }

  resetAll(): void {
    this.save({ overrides: {} });
  }

  onChange(cb: (overrides: Partial<Record<SelectorKey, string>>) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  close(): void {
    this.file.close();
    this.listeners.clear();
  }

  private keys(): SelectorKey[] {
    return Object.keys(this.defaults) as SelectorKey[];
  }

  private isKey(key: string): key is SelectorKey {
    return Object.prototype.hasOwnProperty.call(this.defaults, key);
  }

  private statusOf(key: SelectorKey, entry: { selector: string; replacedDefault: string } | undefined): SelectorStatus {
    if (!entry) return 'default';
    return entry.replacedDefault === this.defaults[key] ? 'overridden' : 'stale';
  }

  /** A file we cannot read is kept for the user, exactly as an unreadable settings.json is. */
  private read(): SelectorsFile {
    const text = this.file.read();
    try {
      return FileSchema.parse(JSON.parse(text));
    } catch (err) {
      this.setAside(err);
      return { overrides: {} };
    }
  }

  private save(data: SelectorsFile): void {
    this.file.write(this.render(data));
    this.emit();
  }

  private render(data: SelectorsFile): string {
    return `${JSON.stringify({ _comment: SELECTORS_COMMENT, appVersion: this.appVersion, overrides: data.overrides }, null, 2)}\n`;
  }

  private setAside(err: unknown): void {
    const kept = `${this.file.path}.corrupt-${randomUUID()}`;
    const why = err instanceof Error ? err.message : String(err);
    try {
      renameSync(this.file.path, kept);
      console.error(`[xpilot] ${this.file.path} could not be read (${why}); moved to ${kept} and started from the shipped selectors`);
    } catch (moveErr) {
      console.error(
        `[xpilot] ${this.file.path} could not be read (${why}) and could not be moved aside (${moveErr instanceof Error ? moveErr.message : String(moveErr)}); using the shipped selectors`,
      );
    }
  }

  private emit(): void {
    const overrides = this.overrides();
    for (const cb of [...this.listeners]) cb(overrides);
  }
}
