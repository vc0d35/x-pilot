import { AppStore } from '../history/store';
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentController, NO_PROVIDER_MESSAGE, toolsFingerprint, transcriptEvent, MAX_TRANSCRIPT_OUTPUT } from './controller';
import type { ScheduledTask } from '../../shared/sidebar-api';
import type { AgentProvider, StartOptions } from './provider';
import { ToolRegistry } from '../tools/registry';
import { SettingsStore } from '../settings';
import { ThreadState } from './thread-state';
import type { AgentEvent } from '../../shared/agent';

function fakeProvider(startImpl?: (o: StartOptions) => Promise<{ threadId: string }>, kind: 'codex' | 'claude' = 'codex') {
  const listeners = new Set<(e: AgentEvent) => void>();
  const p: AgentProvider & { starts: StartOptions[]; sent: string[]; emitEvent: (e: AgentEvent) => void; running: boolean } = {
    id: 'fake',
    kind,
    capabilities: { toolsFrozenPerThread: kind === 'codex' },
    starts: [],
    sent: [],
    running: false,
    start: vi.fn(async (o: StartOptions) => {
      p.starts.push(o);
      return startImpl ? startImpl(o) : { threadId: 'T' };
    }),
    send: vi.fn(async (text: string) => {
      p.sent.push(text);
    }),
    interrupt: vi.fn(async () => {}),
    listModels: vi.fn(async () => []),
    onEvent: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    isRunning: () => p.running,
    stop: vi.fn(async () => {}),
    emitEvent: (e: AgentEvent) => {
      for (const cb of listeners) cb(e);
    },
  };
  return p;
}

/** A fresh profile with a provider already chosen; a profile with none is the picker's business. */
const settings = (provider: 'codex' | 'claude' | null = 'codex') => {
  const store = new SettingsStore(join(mkdtempSync(join(tmpdir(), 'xp-')), 's.json'));
  if (provider) store.update({ agent: { provider } });
  return store;
};
const threadState = (store: SettingsStore) => ThreadState.beside(store.filePath);

describe('AgentController', () => {
  it('starts with registry tools, persists the thread id, and resumes it next time', async () => {
    const registry = new ToolRegistry();
    registry.addSource({
      id: 's',
      list: () => [{ name: 'x_a', description: 'a', inputSchema: {} }],
      call: async () => ({ success: true, content: 1 }),
    });
    const store = settings();
    const providers = [fakeProvider(), fakeProvider()];
    let i = 0;
    const ctl = new AgentController({ registry, settings: store, workspaceDir: '/tmp', createProvider: () => providers[i++] });
    await ctl.start({ resume: true });
    expect(providers[0].starts[0].tools.map((t) => t.name)).toEqual(['x_a']);
    expect(providers[0].starts[0].threadId).toBeNull();
    // No threadState dependency: the controller falls back to a file beside settings.json.
    expect(threadState(store).get()).toEqual({ threadId: 'T', threadToolsHash: toolsFingerprint(registry.list()), provider: 'codex' });
    await ctl.start({ resume: true });
    expect(providers[0].stop).toHaveBeenCalled();
    expect(providers[1].starts[0].threadId).toBe('T');
  });

  it('starts a fresh thread when the tool list no longer matches the stored fingerprint', async () => {
    const registry = new ToolRegistry();
    registry.addSource({
      id: 's',
      list: () => [{ name: 'x_a', description: 'a', inputSchema: {} }],
      call: async () => ({ success: true, content: 1 }),
    });
    const store = settings();
    const state = threadState(store);
    state.set({ threadId: 'old', threadToolsHash: 'a-hash-from-a-different-tool-list' });
    const provider = fakeProvider();
    const ctl = new AgentController({
      registry,
      settings: store,
      workspaceDir: '/tmp',
      createProvider: () => provider,
      threadState: state,
    });
    await ctl.start({ resume: true });
    expect(provider.starts[0].threadId).toBeNull();
    expect(state.get()).toEqual({ threadId: 'T', threadToolsHash: toolsFingerprint(registry.list()), provider: 'codex' });
  });

  it('newThread clears the thread id and emits provider errors as status', async () => {
    const store = settings();
    threadState(store).set({ threadId: 'old' });
    const failing = fakeProvider(async () => {
      throw new Error('no codex');
    });
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
    const firstDeferred = new Promise<{ threadId: string }>((resolve) => {
      resolveFirst = resolve;
    });
    const providers = [fakeProvider(() => firstDeferred), fakeProvider()];
    let i = 0;
    const ctl = new AgentController({
      registry: new ToolRegistry(),
      settings: store,
      workspaceDir: '/tmp',
      createProvider: () => providers[i++],
    });
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
    expect(threadState(store).get().threadId).toBe('T');
    expect(events.some((e) => e.type === 'status' && e.status === 'error')).toBe(false);
  });

  it('a stale start() that rejects after a newer one has taken over does not emit an error', async () => {
    const store = settings();
    let rejectFirst!: (e: unknown) => void;
    const firstDeferred = new Promise<{ threadId: string }>((_resolve, reject) => {
      rejectFirst = reject;
    });
    const providers = [fakeProvider(() => firstDeferred), fakeProvider()];
    let i = 0;
    const ctl = new AgentController({
      registry: new ToolRegistry(),
      settings: store,
      workspaceDir: '/tmp',
      createProvider: () => providers[i++],
    });
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
    const ctl = new AgentController({
      registry: new ToolRegistry(),
      settings: store,
      workspaceDir: '/tmp',
      createProvider: () => providers[i++],
    });
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
    const ctl = new AgentController({
      registry: new ToolRegistry(),
      settings: store,
      workspaceDir: '/tmp',
      createProvider: () => providers[i++],
    });
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
    const ctl = new AgentController({
      registry: new ToolRegistry(),
      settings: store,
      workspaceDir: '/tmp',
      createProvider: () => providers[i++],
    });
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
    const long = {
      type: 'tool.completed' as const,
      itemId: 'c1',
      name: 'x_read_post',
      success: true,
      output: 'a'.repeat(MAX_TRANSCRIPT_OUTPUT + 500),
    };
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
    const appStore = new AppStore(':memory:');
    const provider = fakeProvider();
    const ctl = new AgentController({
      registry: new ToolRegistry(),
      settings: store,
      store: appStore,
      workspaceDir: '/tmp',
      createProvider: () => provider,
    });
    await ctl.start({ resume: false });
    provider.emitEvent({ type: 'tool.completed', itemId: 'c1', name: 'x_read_post', success: true, output: 'z'.repeat(20_000) });
    const stored = appStore.listEvents('T')[0] as { output: string };
    expect(stored.output.length).toBeLessThan(5000);
    expect(stored.output.endsWith('… [truncated]')).toBe(true);
  });
});

describe('record()', () => {
  it("puts a view's tool call on the stream and keeps it in the conversation", async () => {
    const registry = new ToolRegistry();
    const appStore = new AppStore(':memory:');
    const provider = fakeProvider();
    const ctl = new AgentController({
      registry,
      settings: settings(),
      store: appStore,
      workspaceDir: '/tmp',
      createProvider: () => provider,
    });
    const events: AgentEvent[] = [];
    ctl.onEvent((e) => events.push(e));
    await ctl.start({ resume: false });
    ctl.record({ type: 'tool.started', itemId: 'v1', name: 'view:x_like_post', args: { url: 'u' } });
    ctl.record({ type: 'tool.completed', itemId: 'v1', name: 'view:x_like_post', success: true, output: '{}' });
    expect(events.filter((e) => e.type.startsWith('tool.'))).toHaveLength(2);
    expect(appStore.listEvents('T').map((e) => e.type)).toEqual(['tool.started', 'tool.completed']);
  });

  it("truncates what it stores the same way the provider's own output is truncated", async () => {
    const appStore = new AppStore(':memory:');
    const provider = fakeProvider();
    const ctl = new AgentController({
      registry: new ToolRegistry(),
      settings: settings(),
      store: appStore,
      workspaceDir: '/tmp',
      createProvider: () => provider,
    });
    await ctl.start({ resume: false });
    ctl.record({ type: 'tool.completed', itemId: 'v1', name: 'view:x_search', success: true, output: 'z'.repeat(20_000) });
    const stored = appStore.listEvents('T')[0] as { output: string };
    expect(stored.output.length).toBeLessThan(MAX_TRANSCRIPT_OUTPUT + 100);
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
    const appStore = new AppStore(':memory:');
    const registry = registryWith('x_a');
    appStore.upsertConversation({ threadId: 'old', kind: 'chat', toolsHash: toolsFingerprint(registry.list()) });
    appStore.appendEvent('old', { type: 'user.message', text: 'hi' });
    const provider = fakeProvider(async () => ({ threadId: 'old' }));
    const ctl = new AgentController({ registry, settings: store, store: appStore, workspaceDir: '/tmp', createProvider: () => provider });
    const events: AgentEvent[] = [];
    ctl.onEvent((e) => events.push(e));
    const replay = await ctl.openConversation('old');
    expect(provider.starts[0].threadId).toBe('old');
    expect(replay.events.map((e) => e.type)).toEqual(['user.message']);
    expect(replay.view).toEqual({ threadId: 'old', kind: 'live' });
    expect(events.some((e) => e.type === 'status' && (e.message ?? '').includes('fresh thread'))).toBe(false);
  });

  it('starts a fresh thread and says so when the tools changed since that conversation', async () => {
    const store = settings();
    const appStore = new AppStore(':memory:');
    appStore.upsertConversation({
      threadId: 'old',
      kind: 'chat',
      toolsHash: toolsFingerprint([{ name: 'x_gone', description: 'a', inputSchema: {} }]),
    });
    appStore.appendEvent('old', { type: 'user.message', text: 'hi' });
    const provider = fakeProvider(async () => ({ threadId: 'fresh' }));
    const ctl = new AgentController({
      registry: registryWith('x_a'),
      settings: store,
      store: appStore,
      workspaceDir: '/tmp',
      createProvider: () => provider,
    });
    const events: AgentEvent[] = [];
    ctl.onEvent((e) => events.push(e));
    await ctl.openConversation('old');
    expect(provider.starts[0].threadId).toBeNull();
    expect(ctl.currentThreadId()).toBe('fresh');
    const notice = events.find((e) => e.type === 'status' && (e.message ?? '').includes('fresh thread')) as {
      status: string;
      message: string;
    };
    expect(notice.status).toBe('starting');
  });

  it('does not resume a conversation that was recorded without a tools hash', async () => {
    const store = settings();
    const appStore = new AppStore(':memory:');
    appStore.upsertConversation({ threadId: 'old', kind: 'chat', toolsHash: null });
    const provider = fakeProvider(async () => ({ threadId: 'fresh' }));
    const ctl = new AgentController({
      registry: registryWith('x_a'),
      settings: store,
      store: appStore,
      workspaceDir: '/tmp',
      createProvider: () => provider,
    });
    await ctl.openConversation('old');
    expect(provider.starts[0].threadId).toBeNull();
  });
});

describe('conversations', () => {
  it('records the thread and its events, and reopens a conversation by id', async () => {
    const store = settings();
    const appStore = new AppStore(':memory:');
    const providers = [fakeProvider(), fakeProvider(async () => ({ threadId: 'T2' })), fakeProvider()];
    let i = 0;
    const ctl = new AgentController({
      registry: new ToolRegistry(),
      settings: store,
      store: appStore,
      workspaceDir: '/tmp',
      createProvider: () => providers[i++],
    });
    await ctl.start({ resume: false });
    providers[0].emitEvent({ type: 'user.message', text: 'hello there' });
    providers[0].emitEvent({ type: 'message.completed', itemId: 'm1', text: 'hi' });
    providers[0].emitEvent({ type: 'message.delta', itemId: 'm2', delta: 'not stored' });
    await ctl.start({ resume: false }); // second conversation, thread T2 (empty: not listed)
    expect(appStore.listConversations().map((c) => [c.threadId, c.title])).toEqual([['T', 'hello there']]);
    const before = i;
    await ctl.openConversation('T2'); // reopening the live thread does not restart the provider
    expect(i).toBe(before);
    expect(appStore.listEvents('T').map((e) => e.type)).toEqual(['user.message', 'message.completed']);
    const opened = await ctl.openConversation('T');
    expect(providers[2].starts[0].threadId).toBe('T');
    expect(opened.events.map((e) => e.type)).toEqual(['user.message', 'message.completed']);
    expect(opened.view).toEqual({ threadId: 'T', kind: 'live' });
    expect(threadState(store).get().threadId).toBe('T');
  });
});

describe('opening a scheduled run', () => {
  const withRun = (lastStatus: ScheduledTask['lastStatus']) => {
    const appStore = new AppStore(':memory:');
    const task = appStore.createTask({
      title: 'Weather',
      prompt: 'Post the weather',
      schedule: { every: '1h' },
      threadMode: 'resume',
      nextRunAt: null,
    });
    appStore.updateTask(task.id, { lastStatus });
    appStore.upsertConversation({ threadId: 'run-1', kind: 'task', taskId: task.id, toolsHash: 'h' });
    appStore.appendEvent('run-1', { type: 'user.message', text: 'Scheduled task "Weather"' });
    appStore.appendEvent('run-1', { type: 'message.completed', itemId: 'm1', text: 'posted' });
    return appStore;
  };

  it('returns the stored transcript as a read-only view without touching the live thread or provider', async () => {
    const store = settings();
    const appStore = withRun('running');
    const live = fakeProvider();
    const runProvider = fakeProvider();
    let i = 0;
    const ctl = new AgentController({
      registry: new ToolRegistry(),
      settings: store,
      store: appStore,
      workspaceDir: '/tmp',
      createProvider: () => [live, runProvider][i++],
    });
    await ctl.start({ resume: false });
    const opened = await ctl.openConversation('run-1');
    expect(opened.events.map((e) => e.type)).toEqual(['user.message', 'message.completed']);
    expect(opened.view).toEqual({ threadId: 'run-1', kind: 'task', taskId: 1, title: 'Weather', running: true });
    expect(i).toBe(1); // no second provider: nothing was started on the run's thread
    expect(live.stop).not.toHaveBeenCalled();
    expect(ctl.currentThreadId()).toBe('T');
    expect(threadState(store).get().threadId).toBe('T');
  });

  it('reports a finished run as not running', async () => {
    const store = settings();
    const ctl = new AgentController({
      registry: new ToolRegistry(),
      settings: store,
      store: withRun('completed'),
      workspaceDir: '/tmp',
      createProvider: () => fakeProvider(),
    });
    expect((await ctl.openConversation('run-1')).view).toMatchObject({ kind: 'task', running: false });
  });

  it('start() refuses to resume a run thread and keeps the current one', async () => {
    const store = settings();
    const appStore = withRun('running');
    const providers = [fakeProvider(), fakeProvider()];
    let i = 0;
    const ctl = new AgentController({
      registry: new ToolRegistry(),
      settings: store,
      store: appStore,
      workspaceDir: '/tmp',
      createProvider: () => providers[i++],
    });
    await ctl.start({ resume: false });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await ctl.start({ resume: true, threadId: 'run-1' });
    warn.mockRestore();
    expect(i).toBe(1);
    expect(ctl.currentThreadId()).toBe('T');
    expect(threadState(store).get().threadId).toBe('T');
    expect(providers[0].stop).not.toHaveBeenCalled();
  });
});

describe('choosing a provider', () => {
  const registry = () => {
    const r = new ToolRegistry();
    r.addSource({
      id: 's',
      list: () => [{ name: 'x_a', description: 'a', inputSchema: {} }],
      call: async () => ({ success: true, content: 1 }),
    });
    return r;
  };

  it('does not start at all until a provider is chosen, and says why', async () => {
    const store = settings(null);
    const events: AgentEvent[] = [];
    const ctl = new AgentController({ registry: registry(), settings: store, workspaceDir: '/tmp', createProvider: () => fakeProvider() });
    ctl.onEvent((e) => events.push(e));
    await ctl.start({ resume: true });
    expect(events).toEqual([{ type: 'status', status: 'disconnected', message: NO_PROVIDER_MESSAGE }]);
    await expect(ctl.send('hi', null)).rejects.toThrow('Agent is not running');
  });

  it('switchProvider records the choice and starts a fresh thread on the new provider', async () => {
    const store = settings('codex');
    const state = threadState(store);
    state.set({ threadId: 'old-codex', threadToolsHash: 'h', provider: 'codex' });
    const claude = fakeProvider(async () => ({ threadId: 'claude-1' }), 'claude');
    const kinds: string[] = [];
    const ctl = new AgentController({
      registry: registry(),
      settings: store,
      threadState: state,
      workspaceDir: '/tmp',
      createProvider: (kind) => {
        kinds.push(kind);
        return claude;
      },
    });
    await ctl.switchProvider('claude');
    expect(store.get().agent.provider).toBe('claude');
    expect(kinds).toEqual(['claude']);
    expect(claude.starts[0].threadId).toBeNull();
    expect(state.get()).toMatchObject({ threadId: 'claude-1', provider: 'claude' });
  });

  it('never resumes a thread the other provider started', async () => {
    const store = settings('claude');
    const state = threadState(store);
    state.set({ threadId: 'codex-thread', threadToolsHash: toolsFingerprint(registry().list()), provider: 'codex' });
    const claude = fakeProvider(async () => ({ threadId: 'claude-1' }), 'claude');
    const events: AgentEvent[] = [];
    const ctl = new AgentController({
      registry: registry(),
      settings: store,
      threadState: state,
      workspaceDir: '/tmp',
      createProvider: () => claude,
    });
    ctl.onEvent((e) => events.push(e));
    await ctl.start({ resume: true });
    expect(claude.starts[0].threadId).toBeNull();
    expect(events.find((e) => e.type === 'status' && e.message?.includes('belongs to Codex'))).toBeTruthy();
  });

  it('resumes a Claude thread whose tools changed, because Claude does not freeze them', async () => {
    const store = settings('claude');
    const state = threadState(store);
    state.set({ threadId: 'claude-1', threadToolsHash: 'a-different-hash', provider: 'claude' });
    const claude = fakeProvider(async () => ({ threadId: 'claude-1' }), 'claude');
    const ctl = new AgentController({
      registry: registry(),
      settings: store,
      threadState: state,
      workspaceDir: '/tmp',
      createProvider: () => claude,
    });
    await ctl.start({ resume: true });
    expect(claude.starts[0].threadId).toBe('claude-1');
  });

  it('hands the whole agent settings slice to the provider, so each reads its own part', async () => {
    const store = settings('claude');
    const provider = fakeProvider(undefined, 'claude');
    const ctl = new AgentController({ registry: registry(), settings: store, workspaceDir: '/tmp', createProvider: () => provider });
    await ctl.start({ resume: true });
    expect(provider.starts[0].settings.claude.model).toBe('claude-sonnet-5');
    expect(provider.starts[0].settings.codex.model).toBeTruthy();
  });

  it('opens a conversation the other provider wrote as a read-only foreign view', async () => {
    const store = settings('claude');
    const appStore = new AppStore(':memory:');
    appStore.upsertConversation({ threadId: 'codex-1', kind: 'chat', toolsHash: null, provider: 'codex' });
    appStore.appendEvent('codex-1', { type: 'user.message', text: 'from the codex days' });
    const providers = [fakeProvider(undefined, 'claude'), fakeProvider(undefined, 'claude')];
    let i = 0;
    const ctl = new AgentController({
      registry: registry(),
      settings: store,
      store: appStore,
      workspaceDir: '/tmp',
      createProvider: () => providers[i++],
    });
    await ctl.start({ resume: false });
    const opened = await ctl.openConversation('codex-1');
    expect(opened.view).toEqual({ threadId: 'codex-1', kind: 'foreign', provider: 'codex' });
    expect(opened.events.map((e) => e.type)).toEqual(['user.message']);
    expect(i).toBe(1); // nothing was restarted on it
  });

  it('records the provider on the conversations it writes', async () => {
    const store = settings('claude');
    const appStore = new AppStore(':memory:');
    const provider = fakeProvider(async () => ({ threadId: 'claude-1' }), 'claude');
    const ctl = new AgentController({
      registry: registry(),
      settings: store,
      store: appStore,
      workspaceDir: '/tmp',
      createProvider: () => provider,
    });
    await ctl.start({ resume: false });
    expect(appStore.getConversation('claude-1')?.provider).toBe('claude');
  });

  it('follows a provider that re-points its thread mid-turn', async () => {
    const store = settings('claude');
    const appStore = new AppStore(':memory:');
    const state = threadState(store);
    const provider = fakeProvider(async () => ({ threadId: 'claude-1' }), 'claude');
    const ctl = new AgentController({
      registry: registry(),
      settings: store,
      store: appStore,
      threadState: state,
      workspaceDir: '/tmp',
      createProvider: () => provider,
    });
    await ctl.start({ resume: false });
    provider.emitEvent({ type: 'thread', threadId: 'claude-2' });
    provider.emitEvent({ type: 'user.message', text: 'after the move' });
    expect(ctl.currentThreadId()).toBe('claude-2');
    expect(state.get().threadId).toBe('claude-2');
    expect(appStore.listEvents('claude-2').map((e) => e.type)).toEqual(['user.message']);
  });

  it('offers the static Claude models for a provider that is not running, and says when it has none', async () => {
    const store = settings('codex');
    const provider = fakeProvider();
    const ctl = new AgentController({ registry: registry(), settings: store, workspaceDir: '/tmp', createProvider: () => provider });
    await ctl.start({ resume: true });
    expect((await ctl.modelsFor('claude')).models.map((m) => m.id)).toContain('claude-sonnet-5');
    // Codex is running here but its fake reports nothing, so the list is flagged unavailable.
    expect(await ctl.modelsFor('codex')).toEqual({ provider: 'codex', models: [], unavailable: true });
  });

  it('probes a provider with one short turn and leaves the live one alone', async () => {
    const store = settings('codex');
    const live = fakeProvider();
    const probe = fakeProvider(async () => ({ threadId: 'probe' }), 'claude');
    const created: string[] = [];
    const ctl = new AgentController({
      registry: registry(),
      settings: store,
      workspaceDir: '/tmp',
      createProvider: (kind) => {
        created.push(kind);
        return created.length === 1 ? live : probe;
      },
    });
    await ctl.start({ resume: true });
    const result = ctl.probeProvider('claude');
    await vi.waitFor(() => expect(probe.sent).toHaveLength(1));
    probe.emitEvent({ type: 'turn.completed', turnId: 't', status: 'completed' });
    expect(await result).toEqual({ ok: true, model: 'claude-sonnet-5' });
    expect(probe.sent[0]).toBe('Reply with the single word OK.');
    expect(probe.starts[0].tools).toEqual([]);
    expect(probe.stop).toHaveBeenCalled();
    expect(live.stop).not.toHaveBeenCalled();
    expect(ctl.currentThreadId()).toBe('T');
  });

  it('reports a probe that fails with the error the provider gave', async () => {
    const store = settings('codex');
    const probe = fakeProvider(async () => ({ threadId: 'probe' }), 'claude');
    const providers = [fakeProvider(), probe];
    let i = 0;
    const ctl = new AgentController({
      registry: registry(),
      settings: store,
      workspaceDir: '/tmp',
      createProvider: () => providers[i++],
    });
    await ctl.start({ resume: true });
    const result = ctl.probeProvider('claude');
    await vi.waitFor(() => expect(probe.sent).toHaveLength(1));
    probe.emitEvent({ type: 'turn.completed', turnId: 't', status: 'failed', error: 'Invalid API key' });
    expect(await result).toEqual({ ok: false, error: 'Invalid API key' });
  });
});
