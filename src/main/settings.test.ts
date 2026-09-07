import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SettingsStore } from './settings';
import { AUTONOMOUS_WARNING, confirmPostingMode } from '../shared/settings';

const tmpFile = () => join(mkdtempSync(join(tmpdir(), 'xpilot-')), 'settings.json');

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

  it('ignores corrupt files and notifies listeners', () => {
    const file = tmpFile();
    writeFileSync(file, '{not json');
    const s = new SettingsStore(file);
    expect(s.get().posting.mode).toBe('confirm');
    const seen: string[] = [];
    s.onChange((st) => seen.push(st.posting.mode));
    s.update({ posting: { mode: 'autonomous' } });
    expect(seen).toEqual(['autonomous']);
  });
});

describe('confirmPostingMode', () => {
  it('warns once before switching to autonomous and honours the answer', () => {
    const seen: string[] = [];
    const yes = (m: string) => { seen.push(m); return true; };
    const no = (m: string) => { seen.push(m); return false; };
    expect(confirmPostingMode('autonomous', yes)).toBe('autonomous');
    expect(confirmPostingMode('autonomous', no)).toBeNull();
    expect(seen).toEqual([AUTONOMOUS_WARNING, AUTONOMOUS_WARNING]);
  });

  it('never warns when switching back to confirm', () => {
    const confirmFn = () => { throw new Error('should not be asked'); };
    expect(confirmPostingMode('confirm', confirmFn)).toBe('confirm');
  });
});
