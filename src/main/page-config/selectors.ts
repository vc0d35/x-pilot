import { z } from 'zod';
import { WatchedFile } from './file';
import { SELECTOR_DEFAULTS, SELECTOR_DESCRIPTIONS, isActionSelectorKey, type SelectorKey } from '../../shared/selectors';

export const SELECTORS_FILE = 'selectors.json';
export const MAX_SELECTOR_LENGTH = 512;

/** JSON carries no comments, so the explanation is a field. It is rewritten with every save. */
export const SELECTORS_COMMENT =
  'XPilot selector overrides. Each entry replaces one CSS selector the page adapter uses to read x.com, in every X window. ' +
  'replacedDefault is the selector XPilot shipped when the override was written: if a later version ships a different default, ' +
  'the override is kept and reported as stale, so nothing you fixed is dropped and nothing new is silently ignored. ' +
  'Keys with no entry always follow the shipped default; delete an entry to go back to it. ' +
  'A key XPilot no longer ships is kept as written but never applied. ' +
  'The keys that drive actions rather than reads (the composer, the Post, Like and Unlike buttons, the tabs, Show more, ' +
  'dialogs and toasts) can only be changed here, by you: no tool can write them, because they decide what XPilot clicks.';

const EntrySchema = z.object({ selector: z.string(), replacedDefault: z.string() });
const FileSchema = z.object({
  _comment: z.string().optional(),
  /** Informational only: the sync rule runs on `replacedDefault`, so nothing reads this back. */
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
  /** True for the keys a tool clicks or types into: settable only by editing the file by hand. */
  locked: boolean;
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
 *
 * The parsed file is held in memory and refreshed only when the file changes or we write it, so a
 * half-written save cannot be observed by the synchronous startup reply, and a file that cannot be
 * read or parsed leaves the last good value in place rather than being renamed away.
 */
export class SelectorOverrides {
  readonly appVersion: string;
  private readonly file: WatchedFile;
  private readonly defaults: Record<SelectorKey, string>;
  private readonly descriptions: Record<SelectorKey, string>;
  private readonly listeners = new Set<(overrides: Partial<Record<SelectorKey, string>>) => void>();
  /** The last file that parsed; `needsRead` is set by a watch event, not by every read. */
  private cached: SelectorsFile | null = null;
  private needsRead = true;
  private error: string | null = null;

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
    this.file.onChange(() => {
      this.needsRead = true;
      this.emit();
    });
  }

  get path(): string {
    return this.file.path;
  }

  /** Why the file on disk is not what is in effect, or null when it was read and parsed. */
  get lastError(): string | null {
    return this.error;
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
        locked: isActionSelectorKey(key),
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

  /**
   * The parsed file, from memory. A read or parse failure is reported once and leaves whatever was
   * last understood in place: the user's file is theirs, and half of a save is not a reason to throw
   * their overrides away.
   */
  private read(): SelectorsFile {
    if (!this.needsRead && this.cached) return this.cached;
    let parsed: SelectorsFile;
    try {
      parsed = FileSchema.parse(JSON.parse(this.file.read()));
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      if (this.error !== why)
        console.error(`[xpilot] ${this.file.path} could not be read (${why}); keeping the selectors already in effect`);
      this.error = why;
      this.needsRead = false;
      this.cached ??= { overrides: {} };
      return this.cached;
    }
    this.error = null;
    this.needsRead = false;
    this.cached = parsed;
    this.warnAboutLockedOverrides(parsed);
    return parsed;
  }

  /**
   * A locked key can still be overridden by hand — it is the user's file. It is worth saying out
   * loud, because it changes what XPilot clicks rather than what it reads.
   */
  private warnAboutLockedOverrides(data: SelectorsFile): void {
    for (const [key, entry] of Object.entries(data.overrides)) {
      if (this.isKey(key) && isActionSelectorKey(key))
        console.warn(
          `[xpilot] ${this.file.path} overrides "${key}", which decides what XPilot clicks or types into, with ${JSON.stringify(entry.selector)}`,
        );
    }
  }

  private save(data: SelectorsFile): void {
    this.file.write(this.render(data));
    this.cached = data;
    this.needsRead = false;
    this.error = null;
    this.emit();
  }

  private render(data: SelectorsFile): string {
    return `${JSON.stringify({ _comment: SELECTORS_COMMENT, appVersion: this.appVersion, overrides: data.overrides }, null, 2)}\n`;
  }

  private emit(): void {
    const overrides = this.overrides();
    for (const cb of [...this.listeners]) cb(overrides);
  }
}
