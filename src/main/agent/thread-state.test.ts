import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ThreadState, THREAD_STATE_FILE } from './thread-state';
import { SettingsStore } from '../settings';

const dir = () => mkdtempSync(join(tmpdir(), 'xpilot-thread-'));
const statePath = (d: string) => join(d, THREAD_STATE_FILE);

describe('ThreadState', () => {
  it('starts empty and round-trips through the file', () => {
    const d = dir();
    const s = ThreadState.beside(join(d, 'settings.json'));
    expect(s.get()).toEqual({ threadId: null, threadToolsHash: null, provider: null });
    s.set({ threadId: 'T', threadToolsHash: 'h', provider: 'claude' });
    expect(JSON.parse(readFileSync(statePath(d), 'utf8'))).toEqual({ threadId: 'T', threadToolsHash: 'h', provider: 'claude' });
    expect(new ThreadState(statePath(d)).get()).toEqual({ threadId: 'T', threadToolsHash: 'h', provider: 'claude' });
  });

  it('patches one field at a time and can clear the thread', () => {
    const s = new ThreadState(statePath(dir()));
    s.set({ threadId: 'T', threadToolsHash: 'h', provider: 'codex' });
    s.set({ threadToolsHash: 'h2' });
    expect(s.get()).toEqual({ threadId: 'T', threadToolsHash: 'h2', provider: 'codex' });
    s.set({ threadId: null, threadToolsHash: null, provider: null });
    expect(s.get()).toEqual({ threadId: null, threadToolsHash: null, provider: null });
  });

  it('writes the file private to the user', () => {
    const d = dir();
    new ThreadState(statePath(d)).set({ threadId: 'T' });
    expect(statSync(statePath(d)).mode & 0o777).toBe(0o600);
  });

  it('migrates the thread out of an old settings.json on first run, once', () => {
    const d = dir();
    const settingsPath = join(d, 'settings.json');
    writeFileSync(settingsPath, JSON.stringify({ posting: { mode: 'confirm' }, threadId: 'old', threadToolsHash: 'old-hash' }));
    // A thread from before the split was a Codex thread, and is recorded as one.
    expect(ThreadState.beside(settingsPath).get()).toEqual({ threadId: 'old', threadToolsHash: 'old-hash', provider: 'codex' });
    expect(JSON.parse(readFileSync(statePath(d), 'utf8'))).toEqual({ threadId: 'old', threadToolsHash: 'old-hash', provider: 'codex' });

    // The settings file keeps the stale keys until it is rewritten; the state file now wins.
    new ThreadState(statePath(d)).set({ threadId: 'new' });
    expect(ThreadState.beside(settingsPath).get().threadId).toBe('new');
  });

  it('writes nothing when the old settings file carried no thread', () => {
    const d = dir();
    const settingsPath = join(d, 'settings.json');
    writeFileSync(settingsPath, JSON.stringify({ posting: { mode: 'confirm' } }));
    expect(ThreadState.beside(settingsPath).get()).toEqual({ threadId: null, threadToolsHash: null, provider: null });
    expect(() => readFileSync(statePath(d), 'utf8')).toThrow();
  });

  it('starts without a thread when either file is unreadable', () => {
    const d = dir();
    writeFileSync(join(d, 'settings.json'), 'not json');
    expect(ThreadState.beside(join(d, 'settings.json')).get()).toEqual({ threadId: null, threadToolsHash: null, provider: null });
    const d2 = dir();
    writeFileSync(statePath(d2), '{ oops');
    expect(new ThreadState(statePath(d2)).get()).toEqual({ threadId: null, threadToolsHash: null, provider: null });
  });

  it('ignores values of the wrong type', () => {
    const d = dir();
    writeFileSync(statePath(d), JSON.stringify({ threadId: 42, threadToolsHash: ['h'], provider: 'gemini' }));
    expect(new ThreadState(statePath(d)).get()).toEqual({ threadId: null, threadToolsHash: null, provider: null });
  });
});

describe('settings files written before the split', () => {
  it('load without the moved keys, and lose them on the next write', () => {
    const d = dir();
    const settingsPath = join(d, 'settings.json');
    writeFileSync(settingsPath, JSON.stringify({ posting: { mode: 'autonomous' }, threadId: 'old', threadToolsHash: 'old-hash' }));
    const store = new SettingsStore(settingsPath);
    expect(store.get().posting.mode).toBe('autonomous');
    expect(store.get()).not.toHaveProperty('threadId');
    expect(store.get()).not.toHaveProperty('threadToolsHash');
    store.update({ ui: { onboarded: true } });
    expect(JSON.parse(readFileSync(settingsPath, 'utf8'))).not.toHaveProperty('threadId');
  });
});
