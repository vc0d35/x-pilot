import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  watch,
  writeFileSync,
} from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname } from 'node:path';

const DEBOUNCE_MS = 150;

/**
 * Both files are small by design (a stylesheet is capped at 64 KB, the override file holds at most a
 * couple of dozen short strings), and this read happens on the main process while a page waits.
 */
export const MAX_READ_BYTES = 256 * 1024;

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

  /**
   * The file as the app will use it, or the header when there is nothing usable there. Only a
   * regular file of a sane size is read: a symlink would hand whatever it points at to the agent,
   * and an oversized one would be read synchronously with a page waiting on the answer.
   */
  read(): string {
    if (!existsSync(this.path)) {
      this.write(this.header);
      return this.header;
    }
    const stat = lstatSync(this.path);
    if (!stat.isFile()) {
      console.warn(`[xpilot] ${this.path} is not a regular file; ignoring it`);
      return this.header;
    }
    if (stat.size > MAX_READ_BYTES) {
      console.warn(`[xpilot] ${this.path} is larger than ${MAX_READ_BYTES / 1024} KB; ignoring it`);
      return this.header;
    }
    return readFileSync(this.path, 'utf8');
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
