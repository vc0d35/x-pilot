import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { deepMerge, normalizeSettings, type DeepPartial, type Settings } from '../shared/settings';

export class SettingsStore {
  private current: Settings;
  private readonly listeners = new Set<(s: Settings) => void>();

  constructor(readonly filePath: string) {
    this.current = this.load();
  }

  get(): Settings { return this.current; }

  update(patch: DeepPartial<Settings>): Settings {
    this.current = normalizeSettings(deepMerge(this.current, patch));
    mkdirSync(dirname(this.filePath), { recursive: true });
    // Write-then-rename: a crash mid-write leaves the previous settings intact rather than a truncated file.
    // The name is unpredictable and the open is exclusive, so the write cannot be pointed at another
    // file by planting a symlink where the temp file is about to go.
    const tmp = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      const fd = openSync(tmp, 'wx', 0o600);
      try { writeFileSync(fd, JSON.stringify(this.current, null, 2)); } finally { closeSync(fd); }
      renameSync(tmp, this.filePath);
      chmodSync(this.filePath, 0o600);
    } catch (err) {
      try { unlinkSync(tmp); } catch { /* nothing to clean up */ }
      throw err;
    }
    for (const cb of this.listeners) cb(this.current);
    return this.current;
  }

  onChange(cb: (s: Settings) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private load(): Settings {
    if (!existsSync(this.filePath)) return normalizeSettings({});
    this.restrictMode();
    try {
      return normalizeSettings(JSON.parse(readFileSync(this.filePath, 'utf8')));
    } catch (err) {
      this.setAside(err);
      return normalizeSettings({});
    }
  }

  /** Settings hold the agent's configuration, so a file left group- or world-readable is narrowed on sight. */
  private restrictMode(): void {
    try {
      if (statSync(this.filePath).mode & 0o077) chmodSync(this.filePath, 0o600);
    } catch (err) {
      console.warn(`[xpilot] could not restrict the mode of ${this.filePath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Keeps an unreadable settings file for the user instead of silently overwriting it with defaults. */
  private setAside(err: unknown): void {
    const kept = `${this.filePath}.corrupt-${randomUUID()}`;
    try {
      renameSync(this.filePath, kept);
      console.error(`[xpilot] settings at ${this.filePath} could not be read (${err instanceof Error ? err.message : String(err)}); moved to ${kept} and started from defaults`);
    } catch (moveErr) {
      console.error(`[xpilot] settings at ${this.filePath} could not be read (${err instanceof Error ? err.message : String(err)}) and could not be moved aside (${moveErr instanceof Error ? moveErr.message : String(moveErr)}); started from defaults`);
    }
  }
}
