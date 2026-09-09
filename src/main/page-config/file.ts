import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, watch, writeFileSync } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname } from 'node:path';

const DEBOUNCE_MS = 150;

/**
 * One small text file in the profile that both the user and the agent edit: created on first read
 * with a header explaining what it is, replaced atomically and privately, and watched so an edit
 * made in the user's own editor reaches the app.
 */
export class WatchedFile {
  private readonly header: string;
  private readonly debounceMs: number;
  private readonly listeners = new Set<() => void>();
  private watcher: FSWatcher | null = null;
  private timer: NodeJS.Timeout | null = null;
  private lastWritten: string | null = null;

  constructor(
    readonly path: string,
    opts: { header?: string; debounceMs?: number } = {},
  ) {
    this.header = opts.header ?? '';
    this.debounceMs = opts.debounceMs ?? DEBOUNCE_MS;
  }

  read(): string {
    if (existsSync(this.path)) return readFileSync(this.path, 'utf8');
    this.write(this.header);
    return this.header;
  }

  /** Write-then-rename with an unpredictable, exclusively opened temp file, as settings.json is written. */
  write(text: string): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${randomUUID()}.tmp`;
    try {
      const fd = openSync(tmp, 'wx', 0o600);
      try {
        writeFileSync(fd, text);
      } finally {
        closeSync(fd);
      }
      renameSync(tmp, this.path);
      chmodSync(this.path, 0o600);
    } catch (err) {
      try {
        unlinkSync(tmp);
      } catch {
        /* nothing to clean up */
      }
      throw err;
    }
    this.lastWritten = text;
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    this.startWatching();
    return () => this.listeners.delete(cb);
  }

  close(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.watcher?.close();
    this.watcher = null;
    this.listeners.clear();
  }

  /**
   * The directory, not the file: an atomic write replaces the inode, which a watcher on the file
   * itself would follow out of existence.
   */
  private startWatching(): void {
    if (this.watcher) return;
    const name = basename(this.path);
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      this.watcher = watch(dirname(this.path), (_event, filename) => {
        if (filename && basename(filename.toString()) !== name) return;
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => this.flush(), this.debounceMs);
      });
      this.watcher.on('error', (err) => console.warn(`[xpilot] stopped watching ${this.path}`, err));
    } catch (err) {
      console.warn(`[xpilot] could not watch ${this.path}`, err);
    }
  }

  /** Our own write is already known to whoever made it; only a differing file is worth reporting. */
  private flush(): void {
    this.timer = null;
    let text: string | null;
    try {
      text = readFileSync(this.path, 'utf8');
    } catch {
      text = null;
    }
    if (text !== null && text === this.lastWritten) return;
    this.lastWritten = null;
    for (const cb of [...this.listeners]) cb();
  }
}
