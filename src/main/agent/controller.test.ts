import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentController } from './controller';
import type { AgentProvider, StartOptions } from './provider';
import { ToolRegistry } from '../tools/registry';
import { SettingsStore } from '../settings';
import type { AgentEvent } from '../../shared/agent';

function fakeProvider(startImpl?: (o: StartOptions) => Promise<{ threadId: string }>) {
  const listeners = new Set<(e: AgentEvent) => void>();
  const p: AgentProvider & { starts: StartOptions[]; sent: string[] } = {
    id: 'fake', starts: [], sent: [],
    start: vi.fn(async (o: StartOptions) => { p.starts.push(o); return startImpl ? startImpl(o) : { threadId: 'T' }; }),
    send: vi.fn(async (text: string) => { p.sent.push(text); }),
    interrupt: vi.fn(async () => {}),
    listModels: vi.fn(async () => []),
    onEvent: (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    isRunning: () => false,
    stop: vi.fn(async () => {}),
  };
  return p;
}

const settings = () => new SettingsStore(join(mkdtempSync(join(tmpdir(), 'xp-')), 's.json'));

describe('AgentController', () => {
  it('starts with registry tools, persists the thread id, and resumes it next time', async () => {
    const registry = new ToolRegistry();
    registry.addSource({ id: 's', list: () => [{ name: 'x_a', description: 'a', inputSchema: {} }], call: async () => ({ success: true, content: 1 }) });
    const store = settings();
    const providers = [fakeProvider(), fakeProvider()];
    let i = 0;
    const ctl = new AgentController({ registry, settings: store, workspaceDir: '/tmp', createProvider: () => providers[i++] });
    await ctl.start({ resume: true });
    expect(providers[0].starts[0].tools.map((t) => t.name)).toEqual(['x_a']);
    expect(providers[0].starts[0].threadId).toBeNull();
    expect(store.get().threadId).toBe('T');
    await ctl.start({ resume: true });
    expect(providers[0].stop).toHaveBeenCalled();
    expect(providers[1].starts[0].threadId).toBe('T');
  });

  it('newThread clears the thread id and emits provider errors as status', async () => {
    const store = settings();
    store.update({ threadId: 'old' });
    const failing = fakeProvider(async () => { throw new Error('no codex'); });
    const ctl = new AgentController({ registry: new ToolRegistry(), settings: store, workspaceDir: '/tmp', createProvider: () => failing });
    const events: AgentEvent[] = [];
    ctl.onEvent((e) => events.push(e));
    await ctl.start({ resume: false });
    expect(failing.starts[0].threadId).toBeNull();
    expect(events.at(-1)).toEqual({ type: 'status', status: 'error', message: 'no codex' });
  });
});
