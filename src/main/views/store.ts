import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { writeFilePrivately } from '../page-config/file';
import {
  MAX_VIEW_BYTES,
  MAX_VIEW_FILE_BYTES,
  VIEW_ENTRY_FILE,
  VIEW_FILE_EXTENSIONS,
  isViewName,
  type ViewSummary,
} from '../../shared/views';

const DEBOUNCE_MS = 200;
/** A view is a small UI, not a tree: enough depth for assets/ and no more. */
const MAX_DEPTH = 4;
/** One path segment: no dots of its own, no separators, nothing the shell or a URL would reinterpret. */
const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

const ALLOWED = new Set<string>(VIEW_FILE_EXTENSIONS.map((e) => `.${e}`));

/**
 * The relative path of a file inside a view, or null when it is not one. `..`, an absolute path, a
 * backslash, an encoded separator, an unlisted extension and a dotfile are all not one, so the
 * result can be joined onto the view folder without another check.
 */
export function normalizeViewPath(path: string): string | null {
  if (path.includes('\0') || path.includes('\\')) return null;
  const parts = path.split('/').filter((p) => p !== '');
  if (parts.length === 0 || parts.length > MAX_DEPTH) return null;
  if (!parts.every((p) => SEGMENT.test(p))) return null;
  const file = parts[parts.length - 1];
  if (!ALLOWED.has(extname(file).toLowerCase())) return null;
  return parts.join('/');
}

/**
 * Where a file of a view lives on disk, or null when the name or the path is not one we accept.
 * Containment is decided twice — by the path rules above and by the resolved prefix — because the
 * first is what makes a good error message and the second is what makes it true.
 */
export function resolveViewFile(root: string, view: string, path: string): string | null {
  if (!isViewName(view)) return null;
  const rel = normalizeViewPath(path);
  if (rel === null) return null;
  const base = resolve(root, view);
  const file = resolve(base, rel);
  return file.startsWith(base + sep) ? file : null;
}

/** Every file of a view, relative to its folder, in a stable order. */
function walk(dir: string, prefix = '', depth = 1): string[] {
  if (depth > MAX_DEPTH) return [];
  let entries: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    // Symlinks are neither followed nor listed: what a view holds is what was written into it.
    if (entry.isDirectory()) entries = entries.concat(walk(join(dir, entry.name), `${prefix}${entry.name}/`, depth + 1));
    else if (entry.isFile()) entries.push(`${prefix}${entry.name}`);
  }
  return entries;
}

/**
 * The views folder in the profile: one folder per view, holding the files the agent wrote. Reads
 * and writes are contained to it, writes are atomic and private, and the whole folder is watched so
 * a view the user edited in their own editor reloads in the canvas.
 */
export class ViewsStore {
  private watcher: FSWatcher | null = null;
  private readonly listeners = new Set<(view: string) => void>();
  private readonly pending = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private readonly debounceMs: number;

  constructor(
    readonly dir: string,
    opts: { debounceMs?: number } = {},
  ) {
    this.debounceMs = opts.debounceMs ?? DEBOUNCE_MS;
  }

  dirFor(view: string): string {
    const dir = resolveViewFolder(this.dir, view);
    if (!dir) throw new Error(`Not a view name: ${view}`);
    return dir;
  }

  exists(view: string): boolean {
    const dir = resolveViewFolder(this.dir, view);
    return !!dir && isDir(dir);
  }

  /** True when the view has the one file the canvas can load. */
  hasIndex(view: string): boolean {
    const file = resolveViewFile(this.dir, view, VIEW_ENTRY_FILE);
    return !!file && isFile(file);
  }

  list(): ViewSummary[] {
    if (!isDir(this.dir)) return [];
    const views: ViewSummary[] = [];
    for (const entry of readdirSync(this.dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (!entry.isDirectory() || !isViewName(entry.name)) continue;
      const files = this.files(entry.name);
      views.push({
        name: entry.name,
        files: files.length,
        bytes: files.reduce((sum, f) => sum + this.sizeOf(entry.name, f), 0),
        hasIndex: files.includes(VIEW_ENTRY_FILE),
      });
    }
    return views;
  }

  files(view: string): string[] {
    const dir = resolveViewFolder(this.dir, view);
    if (!dir || !isDir(dir)) return [];
    return walk(dir);
  }

  read(view: string, path: string): string {
    const file = resolveViewFile(this.dir, view, path);
    if (!file) return refuse(view, path);
    if (!isFile(file)) throw new Error(`${view}/${path} does not exist`);
    if (lstatSync(file).size > MAX_VIEW_FILE_BYTES) throw new Error(`${view}/${path} is larger than ${MAX_VIEW_FILE_BYTES / 1024} KB`);
    return readFileSync(file, 'utf8');
  }

  /** Creates the view folder on the first write. Refuses anything that would grow it past its cap. */
  write(view: string, path: string, content: string): { path: string; bytes: number } {
    const file = resolveViewFile(this.dir, view, path);
    if (!file) return refuse(view, path);
    const bytes = Buffer.byteLength(content);
    if (bytes > MAX_VIEW_FILE_BYTES) throw new Error(`A view file may not be larger than ${MAX_VIEW_FILE_BYTES / 1024} KB`);
    const rel = normalizeViewPath(path)!;
    const others = this.files(view)
      .filter((f) => f !== rel)
      .reduce((sum, f) => sum + this.sizeOf(view, f), 0);
    if (others + bytes > MAX_VIEW_BYTES) throw new Error(`A view may not hold more than ${MAX_VIEW_BYTES / (1024 * 1024)} MB`);
    // A symlink in the way would send the write wherever it points, so it is refused rather than
    // followed; the same goes for a directory standing where the file should be.
    if (existsSync(file) && !isFile(file)) throw new Error(`${view}/${rel} is not a regular file`);
    mkdirSync(this.dirFor(view), { recursive: true, mode: 0o700 });
    writeFilePrivately(file, content);
    return { path: file, bytes };
  }

  delete(view: string): boolean {
    const dir = resolveViewFolder(this.dir, view);
    if (!dir) throw new Error(`Not a view name: ${view}`);
    if (!isDir(dir)) return false;
    rmSync(dir, { recursive: true, force: true });
    return true;
  }

  /**
   * Reports which view changed on disk, debounced: an editor save is several events, and a view is
   * usually written a file at a time. The folder is watched recursively so a file in a subfolder of
   * a view is reported as that view.
   */
  onChange(cb: (view: string) => void): () => void {
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
    this.pending.clear();
  }

  private sizeOf(view: string, rel: string): number {
    const file = resolveViewFile(this.dir, view, rel);
    if (!file) return 0;
    try {
      const stat = lstatSync(file);
      return stat.isFile() ? stat.size : 0;
    } catch {
      return 0;
    }
  }

  private startWatching(): void {
    if (this.watcher) return;
    try {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      this.watcher = watch(this.dir, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const view = filename.toString().split(/[/\\]/)[0];
        // A recursive watch on macOS also reports the watched directory itself, whose basename is a
        // legal view name; only a folder that is actually a view in the store is one that changed.
        if (!isViewName(view) || !isDir(resolve(this.dir, view))) return;
        this.pending.add(view);
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => this.flush(), this.debounceMs);
      });
      this.watcher.on('error', (err) => console.warn(`[xpilot] stopped watching ${this.dir}`, err));
    } catch (err) {
      console.warn(`[xpilot] could not watch ${this.dir}`, err);
    }
  }

  private flush(): void {
    this.timer = null;
    const changed = [...this.pending];
    this.pending.clear();
    // A watcher callback runs on a timer with nothing above it: one that throws would take main
    // down, and the thing it usually reaches into is a canvas that may have just gone away.
    for (const view of changed)
      for (const cb of [...this.listeners]) {
        try {
          cb(view);
        } catch (err) {
          console.warn(`[xpilot] a views watcher listener failed for ${view}`, err);
        }
      }
  }
}

function resolveViewFolder(root: string, view: string): string | null {
  if (!isViewName(view)) return null;
  const base = resolve(root);
  const dir = resolve(base, view);
  return dir.startsWith(base + sep) ? dir : null;
}

function refuse(view: string, path: string): never {
  if (!isViewName(view)) throw new Error(`Not a view name: ${view}. Use lowercase letters, digits and dashes.`);
  throw new Error(
    `Not a usable path inside a view: ${path}. Paths are relative, at most ${MAX_DEPTH} segments deep, and end in one of ${VIEW_FILE_EXTENSIONS.join(', ')}.`,
  );
}

function isDir(path: string): boolean {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}
