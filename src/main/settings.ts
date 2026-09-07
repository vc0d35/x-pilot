import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
    writeFileSync(this.filePath, JSON.stringify(this.current, null, 2));
    for (const cb of this.listeners) cb(this.current);
    return this.current;
  }

  onChange(cb: (s: Settings) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private load(): Settings {
    try {
      if (!existsSync(this.filePath)) return normalizeSettings({});
      return normalizeSettings(JSON.parse(readFileSync(this.filePath, 'utf8')));
    } catch {
      return normalizeSettings({});
    }
  }
}
