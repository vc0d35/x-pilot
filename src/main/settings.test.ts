import { describe, it, expect, vi, afterEach } from 'vitest';
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { SettingsStore } from './settings';

const tmpFile = () => join(mkdtempSync(join(tmpdir(), 'xpilot-')), 'settings.json');

afterEach(() => { vi.restoreAllMocks(); });

describe('SettingsStore', () => {
  it('returns defaults when no file exists', () => {
    const s = new SettingsStore(tmpFile());
    expect(s.get().posting.mode).toBe('confirm');
    expect(s.get().navigation.allowHosts).toContain('x.com');
    expect(s.get().agent.codex.approvalPolicy).toBe('on-request');
  });

  it('persists a partial update and reloads it', () => {
    const file = tmpFile();
    const s = new SettingsStore(file);
    s.update({ posting: { mode: 'autonomous' }, agent: { codex: { model: 'gpt-5' } } });
    expect(JSON.parse(readFileSync(file, 'utf8')).posting.mode).toBe('autonomous');
    const again = new SettingsStore(file);
    expect(again.get().posting.mode).toBe('autonomous');
    expect(again.get().agent.codex.model).toBe('gpt-5');
    expect(again.get().agent.codex.approvalPolicy).toBe('on-request'); // untouched sibling keeps default
  });

  it('moves a corrupt file aside, reports it, and starts from defaults', () => {
    const file = tmpFile();
    writeFileSync(file, '{not json');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = new SettingsStore(file);
    expect(s.get().posting.mode).toBe('confirm');
    expect(err).toHaveBeenCalledWith(expect.stringContaining('could not be read'));
    const kept = readdirSync(dirname(file)).filter((f) => f.startsWith('settings.json.corrupt-'));
    expect(kept).toHaveLength(1);
    expect(readFileSync(join(dirname(file), kept[0]), 'utf8')).toBe('{not json');
    expect(existsSync(file)).toBe(false);
    const seen: string[] = [];
    s.onChange((st) => seen.push(st.posting.mode));
    s.update({ posting: { mode: 'autonomous' } });
    expect(seen).toEqual(['autonomous']);
  });

  it('moves a valid-JSON-but-invalid-settings file aside too', () => {
    const file = tmpFile();
    writeFileSync(file, JSON.stringify({ posting: { mode: 'nonsense' } }));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(new SettingsStore(file).get().posting.mode).toBe('confirm');
    expect(err).toHaveBeenCalled();
    expect(readdirSync(dirname(file)).filter((f) => f.includes('.corrupt-'))).toHaveLength(1);
  });

  it('writes through a temp file and leaves no temp behind', () => {
    const file = tmpFile();
    const s = new SettingsStore(file);
    s.update({ posting: { mode: 'autonomous' } });
    expect(readdirSync(dirname(file))).toEqual(['settings.json']);
    expect(JSON.parse(readFileSync(file, 'utf8')).posting.mode).toBe('autonomous');
  });

  it('writes the file readable only by its owner', () => {
    const file = tmpFile();
    new SettingsStore(file).update({ posting: { mode: 'autonomous' } });
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('narrows a world-readable settings file on the next read', () => {
    const file = tmpFile();
    writeFileSync(file, JSON.stringify({ posting: { mode: 'autonomous' } }));
    chmodSync(file, 0o644);
    expect(new SettingsStore(file).get().posting.mode).toBe('autonomous');
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('cannot be aimed at another file by planting the temp name as a symlink', () => {
    const file = tmpFile();
    const dir = dirname(file);
    const canary = join(dir, 'canary');
    writeFileSync(canary, 'ORIGINAL');
    symlinkSync(canary, `${file}.tmp`);
    const s = new SettingsStore(file);
    s.update({ posting: { mode: 'autonomous' } });
    expect(readFileSync(canary, 'utf8')).toBe('ORIGINAL');
    expect(JSON.parse(readFileSync(file, 'utf8')).posting.mode).toBe('autonomous');
  });
});

describe('window bounds persistence', () => {
  it('defaults to null and round-trips a saved position', () => {
    const file = tmpFile();
    const s = new SettingsStore(file);
    expect(s.get().window.bounds).toBeNull();
    s.update({ window: { bounds: { x: 10, y: 20, width: 1200, height: 800 } } });
    expect(new SettingsStore(file).get().window.bounds).toEqual({ x: 10, y: 20, width: 1200, height: 800 });
  });
});
