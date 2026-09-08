import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { deepMerge, normalizeSettings, type DeepPartial, type Settings } from '../shared/settings';

export class SettingsStore {
  private current: Settings;
  private readonly listeners = new Set<(s: Settings) => void>();

  constructor(private readonly filePath: string) {
    this.current = this.load();
  }

  get(): Settings { return this.current; }

  update(patch: DeepPartial<Settings>): Settings {
    this.current = normalizeSettings(deepMerge(this.current, patch));
    mkdirSync(dirname(this.filePath), { recursive: true });
    // Write-then-rename: a crash mid-write leaves the previous settings intact rather than a truncated file.
    const tmp = `${this.filePath}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(this.current, null, 2));
      renameSync(tmp, this.filePath);
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
    try {
      return normalizeSettings(JSON.parse(readFileSync(this.filePath, 'utf8')));
    } catch (err) {
      this.setAside(err);
      return normalizeSettings({});
    }
  }

  /** Keeps an unreadable settings file for the user instead of silently overwriting it with defaults. */
  private setAside(err: unknown): void {
    const kept = `${this.filePath}.corrupt-${Date.now()}`;
    try {
      renameSync(this.filePath, kept);
      console.error(`[xpilot] settings at ${this.filePath} could not be read (${err instanceof Error ? err.message : String(err)}); moved to ${kept} and started from defaults`);
    } catch (moveErr) {
      console.error(`[xpilot] settings at ${this.filePath} could not be read (${err instanceof Error ? err.message : String(err)}) and could not be moved aside (${moveErr instanceof Error ? moveErr.message : String(moveErr)}); started from defaults`);
    }
  }
}
