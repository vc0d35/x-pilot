import { HistoryStore } from '../history/store';
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentController, toolsFingerprint, transcriptEvent, MAX_TRANSCRIPT_OUTPUT } from './controller';
import type { AgentProvider, StartOptions } from './provider';
import { ToolRegistry } from '../tools/registry';
import { SettingsStore } from '../settings';
import type { AgentEvent } from '../../shared/agent';

function fakeProvider(startImpl?: (o: StartOptions) => Promise<{ threadId: string }>) {
  const listeners = new Set<(e: AgentEvent) => void>();
  const p: AgentProvider & { starts: StartOptions[]; sent: string[]; emitEvent: (e: AgentEvent) => void; running: boolean } = {
    id: 'fake', starts: [], sent: [], running: false,
    start: vi.fn(async (o: StartOptions) => { p.starts.push(o); return startImpl ? startImpl(o) : { threadId: 'T' }; }),
    send: vi.fn(async (text: string) => { p.sent.push(text); }),
    interrupt: vi.fn(async () => {}),
    listModels: vi.fn(async () => []),
    onEvent: (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    isRunning: () => p.running,
    stop: vi.fn(async () => {}),
    emitEvent: (e: AgentEvent) => { for (const cb of listeners) cb(e); },
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
    expect(store.get().threadToolsHash).toBe(toolsFingerprint(registry.list()));
    await ctl.start({ resume: true });
    expect(providers[0].stop).toHaveBeenCalled();
    expect(providers[1].starts[0].threadId).toBe('T');
  });

  it('starts a fresh thread when the tool list no longer matches the stored fingerprint', async () => {
    const registry = new ToolRegistry();
    registry.addSource({ id: 's', list: () => [{ name: 'x_a', description: 'a', inputSchema: {} }], call: async () => ({ success: true, content: 1 }) });
    const store = settings();
    store.update({ threadId: 'old', threadToolsHash: 'a-hash-from-a-different-tool-list' });
    const provider = fakeProvider();
    const ctl = new AgentController({ registry, settings: store, workspaceDir: '/tmp', createProvider: () => provider });
    await ctl.start({ resume: true });
    expect(provider.starts[0].threadId).toBeNull();
    expect(store.get().threadId).toBe('T');
    expect(store.get().threadToolsHash).toBe(toolsFingerprint(registry.list()));
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

  it('a stale start() that resolves after a newer one has taken over does not clobber the live provider or emit an error', async () => {
    const store = settings();
    let resolveFirst!: (v: { threadId: string }) => void;
    const firstDeferred = new Promise<{ threadId: string }>((resolve) => { resolveFirst = resolve; });
    const providers = [fakeProvider(() => firstDeferred), fakeProvider()];
    let i = 0;
    const ctl = new AgentController({ registry: new ToolRegistry(), settings: store, workspaceDir: '/tmp', createProvider: () => providers[i++] });
    const events: AgentEvent[] = [];
    ctl.onEvent((e) => events.push(e));

    const p1 = ctl.start({ resume: true });
    await new Promise((r) => setTimeout(r, 0)); // let p1 reach provider.start() and suspend on the deferred
    const p2 = ctl.start({ resume: true });
    await p2;

    expect(providers[0].stop).toHaveBeenCalled();
    expect(providers[1].starts).toHaveLength(1);

    resolveFirst({ threadId: 'stale' });
    await p1;

    await ctl.send('hi', null);
    expect(providers[1].sent).toEqual(['hi']);
    expect(providers[0].sent).toEqual([]);
    expect(store.get().threadId).toBe('T');
    expect(events.some((e) => e.type === 'status' && e.status === 'error')).toBe(false);
  });

  it('a stale start() that rejects after a newer one has taken over does not emit an error', async () => {
    const store = settings();
    let rejectFirst!: (e: unknown) => void;
    const firstDeferred = new Promise<{ threadId: string }>((_resolve, reject) => { rejectFirst = reject; });
    const providers = [fakeProvider(() => firstDeferred), fakeProvider()];
    let i = 0;
    const ctl = new AgentController({ registry: new ToolRegistry(), settings: store, workspaceDir: '/tmp', createProvider: () => providers[i++] });
    const events: AgentEvent[] = [];
    ctl.onEvent((e) => events.push(e));

    const p1 = ctl.start({ resume: true });
    await new Promise((r) => setTimeout(r, 0));
    const p2 = ctl.start({ resume: true });
    await p2;

    rejectFirst(new Error('stale failure'));
    await p1;

    expect(providers[1].starts).toHaveLength(1);
    expect(events.some((e) => e.type === 'status' && e.status === 'error')).toBe(false);
  });

  it('restarts once when the provider reports disconnected on its own', async () => {
    const store = settings();
    const providers = [fakeProvider(), fakeProvider()];
    let i = 0;
    const ctl = new AgentController({ registry: new ToolRegistry(), settings: store, workspaceDir: '/tmp', createProvider: () => providers[i++] });
    await ctl.start({ resume: true });
    providers[0].emitEvent({ type: 'status', status: 'disconnected' });
    await new Promise((r) => setTimeout(r, 0));
    expect(providers[1].starts).toHaveLength(1);
    providers[1].emitEvent({ type: 'status', status: 'disconnected' });
    await new Promise((r) => setTimeout(r, 0));
    expect(i).toBe(2); // no third provider
  });
});

describe('restartWhenIdle', () => {
  it('restarts immediately when no turn is running', async () => {
    const store = settings();
    const providers = [fakeProvider(), fakeProvider()];
    let i = 0;
    const ctl = new AgentController({ registry: new ToolRegistry(), settings: store, workspaceDir: '/tmp', createProvider: () => providers[i++] });
    await ctl.start({ resume: true });
    ctl.restartWhenIdle();
    await new Promise((r) => setTimeout(r, 0));
    expect(providers[1].starts).toHaveLength(1);
    expect(providers[0].stop).toHaveBeenCalled();
  });

  it('defers a mid-turn restart until turn.completed, and restarts exactly once', async () => {
    const store = settings();
    const providers = [fakeProvider(), fakeProvider(), fakeProvider()];
    let i = 0;
    const ctl = new AgentController({ registry: new ToolRegistry(), settings: store, workspaceDir: '/tmp', createProvider: () => providers[i++] });
    await ctl.start({ resume: true });
    providers[0].running = true;
    ctl.restartWhenIdle();
    ctl.restartWhenIdle();
    await new Promise((r) => setTimeout(r, 0));
    expect(i).toBe(1); // still on the first provider mid-turn

    providers[0].running = false;
    providers[0].emitEvent({ type: 'turn.completed', turnId: 't1', status: 'completed' });
    await new Promise((r) => setTimeout(r, 0));
    expect(providers[1].starts).toHaveLength(1);
    expect(i).toBe(2); // one restart, not two

    providers[1].emitEvent({ type: 'turn.completed', turnId: 't2', status: 'completed' });
    await new Promise((r) => setTimeout(r, 0));
    expect(i).toBe(2);
  });
});

describe('transcript recording', () => {
  it('truncates long tool output and leaves everything else alone', () => {
    const long = { type: 'tool.completed' as const, itemId: 'c1', name: 'x_read_post', success: true, output: 'a'.repeat(MAX_TRANSCRIPT_OUTPUT + 500) };
    const cut = transcriptEvent(long) as typeof long;
    expect(cut.output).toHaveLength(MAX_TRANSCRIPT_OUTPUT + '… [truncated]'.length);
    expect(cut.output.endsWith('… [truncated]')).toBe(true);
    expect(cut).toMatchObject({ itemId: 'c1', name: 'x_read_post', success: true });
    const short = { ...long, output: 'small' };
    expect(transcriptEvent(short)).toBe(short);
    const msg = { type: 'message.completed' as const, itemId: 'm', text: 'b'.repeat(MAX_TRANSCRIPT_OUTPUT + 10) };
    expect(transcriptEvent(msg)).toBe(msg);
  });

  it('stores truncated tool output in the conversation', async () => {
    const store = settings();
    const history = new HistoryStore(':memory:');
    const provider = fakeProvider();
    const ctl = new AgentController({ registry: new ToolRegistry(), settings: store, history, workspaceDir: '/tmp', createProvider: () => provider });
    await ctl.start({ resume: false });
    provider.emitEvent({ type: 'tool.completed', itemId: 'c1', name: 'x_read_post', success: true, output: 'z'.repeat(20_000) });
    const stored = history.listEvents('T')[0] as { output: string };
    expect(stored.output.length).toBeLessThan(5000);
    expect(stored.output.endsWith('… [truncated]')).toBe(true);
  });
});

describe('reopening a conversation', () => {
  const registryWith = (name: string) => {
    const r = new ToolRegistry();
    r.addSource({ id: 's', list: () => [{ name, description: 'a', inputSchema: {} }], call: async () => ({ success: true, content: 1 }) });
    return r;
  };

  it('resumes a conversation whose stored tools hash still matches', async () => {
    const store = settings();
    const history = new HistoryStore(':memory:');
    const registry = registryWith('x_a');
    history.upsertConversation({ threadId: 'old', kind: 'chat', toolsHash: toolsFingerprint(registry.list()) });
    history.appendEvent('old', { type: 'user.message', text: 'hi' });
    const provider = fakeProvider(async () => ({ threadId: 'old' }));
    const ctl = new AgentController({ registry, settings: store, history, workspaceDir: '/tmp', createProvider: () => provider });
    const events: AgentEvent[] = [];
    ctl.onEvent((e) => events.push(e));
    const replay = await ctl.openConversation('old');
    expect(provider.starts[0].threadId).toBe('old');
    expect(replay.map((e) => e.type)).toEqual(['user.message']);
    expect(events.some((e) => e.type === 'status' && (e.message ?? '').includes('fresh thread'))).toBe(false);
  });

  it('starts a fresh thread and says so when the tools changed since that conversation', async () => {
    const store = settings();
    const history = new HistoryStore(':memory:');
    history.upsertConversation({ threadId: 'old', kind: 'chat', toolsHash: toolsFingerprint([{ name: 'x_gone', description: 'a', inputSchema: {} }]) });
    history.appendEvent('old', { type: 'user.message', text: 'hi' });
    const provider = fakeProvider(async () => ({ threadId: 'fresh' }));
    const ctl = new AgentController({ registry: registryWith('x_a'), settings: store, history, workspaceDir: '/tmp', createProvider: () => provider });
    const events: AgentEvent[] = [];
    ctl.onEvent((e) => events.push(e));
    await ctl.openConversation('old');
    expect(provider.starts[0].threadId).toBeNull();
    expect(ctl.currentThreadId()).toBe('fresh');
    const notice = events.find((e) => e.type === 'status' && (e.message ?? '').includes('fresh thread')) as { status: string; message: string };
    expect(notice.status).toBe('starting');
  });

  it('does not resume a conversation that was recorded without a tools hash', async () => {
    const store = settings();
    const history = new HistoryStore(':memory:');
    history.upsertConversation({ threadId: 'old', kind: 'chat', toolsHash: null });
    const provider = fakeProvider(async () => ({ threadId: 'fresh' }));
    const ctl = new AgentController({ registry: registryWith('x_a'), settings: store, history, workspaceDir: '/tmp', createProvider: () => provider });
    await ctl.openConversation('old');
    expect(provider.starts[0].threadId).toBeNull();
  });
});

describe('conversations', () => {
  it('records the thread and its events, and reopens a conversation by id', async () => {
    const store = settings();
    const history = new HistoryStore(':memory:');
    const providers = [fakeProvider(), fakeProvider(async () => ({ threadId: 'T2' })), fakeProvider()];
    let i = 0;
    const ctl = new AgentController({ registry: new ToolRegistry(), settings: store, history, workspaceDir: '/tmp', createProvider: () => providers[i++] });
    await ctl.start({ resume: false });
    providers[0].emitEvent({ type: 'user.message', text: 'hello there' });
    providers[0].emitEvent({ type: 'message.completed', itemId: 'm1', text: 'hi' });
    providers[0].emitEvent({ type: 'message.delta', itemId: 'm2', delta: 'not stored' });
    await ctl.start({ resume: false }); // second conversation, thread T2 (empty: not listed)
    expect(history.listConversations().map((c) => [c.threadId, c.title])).toEqual([['T', 'hello there']]);
    const before = i;
    await ctl.openConversation('T2'); // reopening the live thread does not restart the provider
    expect(i).toBe(before);
    expect(history.listEvents('T').map((e) => e.type)).toEqual(['user.message', 'message.completed']);
    const events = await ctl.openConversation('T');
    expect(providers[2].starts[0].threadId).toBe('T');
    expect(events.map((e) => e.type)).toEqual(['user.message', 'message.completed']);
    expect(store.get().threadId).toBe('T');
  });
});
