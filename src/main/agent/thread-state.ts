import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';

/** The agent's own bookkeeping: not a user setting, so it lives beside settings.json, not inside it. */
export interface ThreadStateData {
  threadId: string | null;
  /** Fingerprint of the tool list the stored thread was started with; a mismatch forces a fresh thread. */
  threadToolsHash: string | null;
}

export const THREAD_STATE_FILE = 'agent-state.json';

const EMPTY: ThreadStateData = { threadId: null, threadToolsHash: null };

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function readState(raw: unknown): ThreadStateData {
  const r = isObj(raw) ? raw : {};
  return {
    threadId: typeof r.threadId === 'string' ? r.threadId : null,
    threadToolsHash: typeof r.threadToolsHash === 'string' ? r.threadToolsHash : null,
  };
}

export class ThreadState {
  private current: ThreadStateData;

  constructor(private readonly filePath: string) {
    this.current = this.load();
  }

  /** The file next to `settingsPath`, which is also where the values are migrated from. */
  static beside(settingsPath: string): ThreadState {
    return new ThreadState(join(dirname(settingsPath), THREAD_STATE_FILE));
  }

  get(): ThreadStateData {
    return this.current;
  }

  set(patch: Partial<ThreadStateData>): ThreadStateData {
    this.current = { ...this.current, ...patch };
    this.write();
    return this.current;
  }

  /** Same atomic, private write as the settings file: an unpredictable temp name, then a rename. */
  private write(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      const fd = openSync(tmp, 'wx', 0o600);
      try {
        writeFileSync(fd, JSON.stringify(this.current, null, 2));
      } finally {
        closeSync(fd);
      }
      renameSync(tmp, this.filePath);
      chmodSync(this.filePath, 0o600);
    } catch (err) {
      try {
        unlinkSync(tmp);
      } catch {
        /* nothing to clean up */
      }
      throw err;
    }
  }

  private load(): ThreadStateData {
    if (existsSync(this.filePath)) {
      this.restrictMode();
      try {
        return readState(JSON.parse(readFileSync(this.filePath, 'utf8')));
      } catch (err) {
        console.warn(
          `[xpilot] ${this.filePath} could not be read (${err instanceof Error ? err.message : String(err)}); starting without a thread`,
        );
        return { ...EMPTY };
      }
    }
    return this.migrateFromSettings();
  }

  /** First run after the split: the thread lived in settings.json, so take it from there once. */
  private migrateFromSettings(): ThreadStateData {
    const settingsPath = join(dirname(this.filePath), 'settings.json');
    if (!existsSync(settingsPath)) return { ...EMPTY };
    try {
      const found = readState(JSON.parse(readFileSync(settingsPath, 'utf8')));
      if (!found.threadId && !found.threadToolsHash) return found;
      this.current = found;
      this.write();
      return found;
    } catch {
      // An unreadable settings file is the SettingsStore's problem to report, not this one's.
      return { ...EMPTY };
    }
  }

  private restrictMode(): void {
    try {
      if (statSync(this.filePath).mode & 0o077) chmodSync(this.filePath, 0o600);
    } catch (err) {
      console.warn(`[xpilot] could not restrict the mode of ${this.filePath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
