import { describe, it, expect } from 'vitest';
import { ClaudeProvider, type ClaudeProviderDeps } from './provider';
import type { ClaudeQueryHandle, ClaudeQueryParams } from './query';
import { CLAUDE_MISSING_MESSAGE } from './binary';
import { ok, type ToolResult } from '../../../shared/tools';
import type { AgentEvent } from '../../../shared/agent';
import { DEFAULT_SETTINGS } from '../../../shared/settings';

/** One scripted turn: SDK messages, and calls into our own tool handlers, in order. */
type Step = Record<string, unknown> | ((params: ClaudeQueryParams) => Promise<void> | void);

const SESSION = 'session-1';
const tools = [{ name: 'x_get_page_state', description: 'state', inputSchema: { type: 'object', properties: {} } }];
const settings = { ...DEFAULT_SETTINGS.agent, provider: 'claude' as const };

const init = (sessionId = SESSION) => ({ type: 'system', subtype: 'init', session_id: sessionId });
const success = (result = 'ok') => ({ type: 'result', subtype: 'success', is_error: false, result, session_id: SESSION });
const streamEvent = (event: Record<string, unknown>) => ({ type: 'stream_event', event });
const blockStart = (index: number, block: Record<string, unknown>) =>
  streamEvent({ type: 'content_block_start', index, content_block: block });
const blockDelta = (index: number, delta: Record<string, unknown>) => streamEvent({ type: 'content_block_delta', index, delta });
const blockStop = (index: number) => streamEvent({ type: 'content_block_stop', index });

function makeProvider(script: Step[] | Step[][], extra: Partial<ClaudeProviderDeps> = {}) {
  const turns: Step[][] = Array.isArray(script[0]) ? (script as Step[][]) : [script as Step[]];
  const calls: ClaudeQueryParams[] = [];
  const interrupts: number[] = [];
  let turn = 0;
  const runQuery = (params: ClaudeQueryParams): ClaudeQueryHandle => {
    calls.push(params);
    const steps = turns[Math.min(turn++, turns.length - 1)];
    return {
      interrupt: async () => {
        interrupts.push(1);
      },
      async *[Symbol.asyncIterator]() {
        for (const step of steps) {
          if (typeof step === 'function') await step(params);
          else yield step;
        }
      },
    };
  };
  const provider = new ClaudeProvider({
    callTool: async (name) => ok({ tool: name }),
    runQuery,
    binary: async () => '/usr/local/bin/claude',
    env: async () => ({ PATH: '/usr/local/bin' }),
    ...extra,
  });
  const events: AgentEvent[] = [];
  provider.onEvent((e) => events.push(e));
  return { provider, events, calls, interrupts };
}

const start = (provider: ClaudeProvider, threadId: string | null = null) =>
  provider.start({ tools, settings, threadId, workspaceDir: '/tmp/workspace' });

const waitFor = async (events: AgentEvent[], type: AgentEvent['type'], ms = 3000) => {
  const start = Date.now();
  while (!events.some((e) => e.type === type)) {
    if (Date.now() - start > ms) throw new Error(`timeout waiting for ${type}`);
    await new Promise((r) => setTimeout(r, 5));
  }
};

const waitUntil = async (ready: () => boolean, ms = 3000) => {
  const started = Date.now();
  while (!ready()) {
    if (Date.now() - started > ms) throw new Error('timeout waiting for a condition');
    await new Promise((r) => setTimeout(r, 5));
  }
};

describe('ClaudeProvider', () => {
  it('names a session up front, adopts the one the CLI reports, and resumes it on the next turn', async () => {
    const { provider, events, calls } = makeProvider([
      [init(), success()],
      [init(), success()],
    ]);
    const { threadId } = await start(provider);
    expect(threadId).toMatch(/^[0-9a-f-]{36}$/);
    expect(events.map((e) => e.type)).toEqual(['status', 'thread', 'status']);
    await provider.send('hello');
    await waitFor(events, 'turn.completed');
    // The first turn names the session; the second continues it.
    expect(calls[0].options.sessionId).toBe(threadId);
    expect(calls[0].options.resume).toBeNull();
    expect(calls[0].options.cwd).toBe('/tmp/workspace');
    expect(calls[0].options.systemPrompt).toContain('You are XPilot');
    await provider.send('again');
    await waitUntil(() => events.filter((e) => e.type === 'turn.completed').length === 2);
    expect(calls[1].options.resume).toBe(SESSION);
    const thread = events.filter((e) => e.type === 'thread').map((e) => e.threadId);
    expect(thread[thread.length - 1]).toBe(SESSION);
    await provider.stop();
  });

  it('streams text and thinking, and completes both blocks', async () => {
    const { provider, events } = makeProvider([
      init(),
      blockStart(0, { type: 'thinking', thinking: '' }),
      blockDelta(0, { type: 'thinking_delta', thinking: 'let me look' }),
      blockStop(0),
      blockStart(1, { type: 'text', text: '' }),
      blockDelta(1, { type: 'text_delta', text: 'You are ' }),
      blockDelta(1, { type: 'text_delta', text: 'on Home.' }),
      blockStop(1),
      success('You are on Home.'),
    ]);
    await start(provider);
    await provider.send('What page?');
    await waitFor(events, 'turn.completed');
    expect(events.filter((e) => e.type === 'thinking.delta').map((e) => e.delta)).toEqual(['let me look']);
    expect(events.find((e) => e.type === 'thinking.completed')?.text).toBe('let me look');
    expect(
      events
        .filter((e) => e.type === 'message.delta')
        .map((e) => e.delta)
        .join(''),
    ).toBe('You are on Home.');
    expect(events.find((e) => e.type === 'message.completed')?.text).toBe('You are on Home.');
    expect(events.filter((e) => e.type === 'activity').map((e) => e.activity)).toEqual(['thinking', 'writing']);
    expect(events.find((e) => e.type === 'turn.completed')).toMatchObject({ status: 'completed' });
    await provider.stop();
  });

  it('runs one of our tools, strips the mcp prefix, and fences the result the model sees', async () => {
    const seen: Array<{ name: string; args: Record<string, unknown> }> = [];
    let answered = '';
    const { provider, events } = makeProvider(
      [
        init(),
        blockStart(0, { type: 'tool_use', id: 'toolu_1', name: 'mcp__xpilot__x_get_page_state' }),
        blockDelta(0, { type: 'input_json_delta', partial_json: '{"view":"visible"}' }),
        async (params) => {
          const tool = params.tools.find((t) => t.name === 'x_get_page_state')!;
          answered = (await tool.handler({ view: 'visible' })).content[0].text;
        },
        blockStop(0),
        { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ignored' }] } },
        success(),
      ],
      {
        callTool: async (name, args) => {
          seen.push({ name, args });
          return ok({ url: 'https://x.com/home' });
        },
      },
    );
    await start(provider);
    await provider.send('What page?');
    await waitFor(events, 'turn.completed');
    expect(seen).toEqual([{ name: 'x_get_page_state', args: { view: 'visible' } }]);
    expect(answered).toBe('<tool-output untrusted source="x.com">\n{"url":"https://x.com/home"}\n</tool-output>');
    const started = events.filter((e) => e.type === 'tool.started');
    const done = events.filter((e) => e.type === 'tool.completed');
    expect(started).toEqual([{ type: 'tool.started', itemId: 'toolu_1', name: 'x_get_page_state', args: { view: 'visible' } }]);
    // The tool_result that follows is not a second row: our handler already reported this call.
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ itemId: 'toolu_1', name: 'x_get_page_state', success: true });
    await provider.stop();
  });

  it('reports a failing tool as a failed row and tells the model it failed', async () => {
    let answered: { text: string; isError?: boolean } = { text: '' };
    const { provider, events } = makeProvider(
      [
        init(),
        blockStart(0, { type: 'tool_use', id: 'toolu_2', name: 'mcp__xpilot__x_get_page_state' }),
        async (params) => {
          const r = await params.tools[0].handler({});
          answered = { text: r.content[0].text, isError: r.isError };
        },
        blockStop(0),
        success(),
      ],
      { callTool: async () => ({ success: false, error: 'the adapter is not ready' }) },
    );
    await start(provider);
    await provider.send('What page?');
    await waitFor(events, 'turn.completed');
    expect(answered.isError).toBe(true);
    expect(answered.text).toContain('Error: the adapter is not ready');
    expect(events.find((e) => e.type === 'tool.completed')).toMatchObject({ success: false });
    await provider.stop();
  });

  it("maps Claude's own web search onto a web_search row with its query", async () => {
    const { provider, events } = makeProvider([
      init(),
      blockStart(0, { type: 'tool_use', id: 'srv_1', name: 'WebSearch' }),
      blockDelta(0, { type: 'input_json_delta', partial_json: '{"query":"electron ' }),
      blockDelta(0, { type: 'input_json_delta', partial_json: 'releases"}' }),
      blockStop(0),
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'srv_1', content: [{ type: 'text', text: 'results' }] }] } },
      success(),
    ]);
    await start(provider);
    await provider.send('What is the latest Electron?');
    await waitFor(events, 'turn.completed');
    expect(events.find((e) => e.type === 'tool.started')).toEqual({
      type: 'tool.started',
      itemId: 'srv_1',
      name: 'web_search',
      args: { queries: ['electron releases'] },
    });
    expect(events.find((e) => e.type === 'tool.completed')).toMatchObject({ name: 'web_search', success: true, output: 'results' });
    expect(events.find((e) => e.type === 'activity')).toMatchObject({ activity: 'tool', detail: 'web_search' });
    await provider.stop();
  });

  it('passes the model, the effort and the web-search choice through, and turns search off when it is off', async () => {
    const { provider, calls } = makeProvider([init(), success()]);
    await provider.start({
      tools,
      settings: { ...settings, claude: { ...settings.claude, model: 'claude-opus-5', effort: 'high', webSearch: 'off' } },
      threadId: null,
      workspaceDir: '/tmp/workspace',
    });
    await provider.send('hi');
    await new Promise((r) => setTimeout(r, 10));
    expect(calls[0].options).toMatchObject({ model: 'claude-opus-5', effort: 'high', webSearch: false });
    await provider.stop();
  });

  it('fails the turn with the error text when the CLI reports one, so the setup card can read it', async () => {
    const { provider, events } = makeProvider([
      init(),
      {
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        errors: ['Invalid API key · Please run /login'],
        session_id: SESSION,
      },
    ]);
    await start(provider);
    await provider.send('hello');
    await waitFor(events, 'turn.completed');
    const done = events.find((e) => e.type === 'turn.completed') as { status: string; error?: string };
    expect(done.status).toBe('failed');
    expect(done.error).toContain('Invalid API key');
    // The turn ends, but the provider is still usable: nothing was disconnected.
    expect(events.filter((e) => e.type === 'status').at(-1)).toMatchObject({ status: 'ready' });
    await provider.stop();
  });

  it('starts a new session and retries once when the session it resumed has been deleted', async () => {
    const { provider, events, calls } = makeProvider([
      [{ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['No conversation found with session ID: gone'] }],
      [init('fresh'), success()],
    ]);
    await start(provider, 'gone');
    await provider.send('hello');
    await waitFor(events, 'turn.completed');
    expect(calls[0].options.resume).toBe('gone');
    expect(calls[1].options.resume).toBeNull();
    expect(events.find((e) => e.type === 'turn.completed')).toMatchObject({ status: 'completed' });
    expect(events.filter((e) => e.type === 'thread').at(-1)).toMatchObject({ threadId: 'fresh' });
    await provider.stop();
  });

  it('interrupts the query and ends the turn as interrupted', async () => {
    const { provider, events, interrupts } = makeProvider([
      init(),
      async () => {
        await provider.interrupt();
      },
      { type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['Interrupted'] },
    ]);
    await start(provider);
    await provider.send('count to a thousand');
    await waitFor(events, 'turn.completed');
    expect(interrupts).toHaveLength(1);
    expect(events.find((e) => e.type === 'turn.completed')).toMatchObject({ status: 'interrupted' });
    await provider.stop();
  });

  it('aborts the turn signal so a tool in flight stops with it', async () => {
    let aborted = false;
    const { provider, events } = makeProvider(
      [
        init(),
        async (params) => {
          const running = params.tools[0].handler({});
          await provider.interrupt();
          await running;
        },
        { type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['Interrupted'] },
      ],
      {
        callTool: async (_name, _args, signal) =>
          new Promise<ToolResult>((resolve) => {
            signal?.addEventListener('abort', () => {
              aborted = true;
              resolve({ success: false, error: 'stopped' });
            });
          }),
      },
    );
    await start(provider);
    await provider.send('read everything');
    await waitFor(events, 'turn.completed');
    expect(aborted).toBe(true);
    await provider.stop();
  });

  it('reports a missing binary as an actionable error', async () => {
    const { provider, events } = makeProvider([init(), success()], { binary: async () => null });
    await expect(start(provider)).rejects.toThrow(CLAUDE_MISSING_MESSAGE);
    expect(events.at(-1)).toEqual({ type: 'status', status: 'error', message: CLAUDE_MISSING_MESSAGE });
    expect(CLAUDE_MISSING_MESSAGE).toContain('claude.com/code');
  });

  it('lists the models it offers, with Sonnet as the default', async () => {
    const { provider } = makeProvider([init(), success()]);
    const models = await provider.listModels();
    expect(models.map((m) => m.id)).toEqual(['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5-20251001']);
    expect(models.find((m) => m.isDefault)?.id).toBe('claude-sonnet-5');
    expect(models[0].reasoningEfforts).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
  });

  it('does not freeze its tools per thread, unlike Codex', () => {
    const { provider } = makeProvider([init(), success()]);
    expect(provider.kind).toBe('claude');
    expect(provider.capabilities.toolsFrozenPerThread).toBe(false);
  });

  it('prepends the page context to the first turn and only its key to an unchanged second one', async () => {
    const { provider, calls } = makeProvider([
      [init(), success()],
      [init(), success()],
    ]);
    await start(provider);
    const ctx = {
      kind: 'post' as const,
      url: 'https://x.com/a/status/1',
      post: { kind: 'post', url: 'https://x.com/a/status/1', authorHandle: 'a', authorName: 'A', text: 'hello there' },
    };
    await provider.send('summarise this', ctx as never);
    await new Promise((r) => setTimeout(r, 10));
    expect(calls[0].prompt).toContain('<page-content untrusted>');
    expect(calls[0].prompt).toContain('hello there');
    expect(calls[0].prompt.endsWith('summarise this')).toBe(true);
    await provider.send('and again', ctx as never);
    await new Promise((r) => setTimeout(r, 10));
    expect(calls[1].prompt).toContain('unchanged since the last turn');
    await provider.stop();
  });

  it('fails the turn when it goes quiet, and warns first', async () => {
    const never: Step[] = [init(), () => new Promise<void>(() => undefined)];
    const { provider, events } = makeProvider(never, { turnIdleWarnMs: 10, turnIdleTimeoutMs: 20 });
    await start(provider);
    await provider.send('hello');
    await waitFor(events, 'turn.completed');
    expect(events.find((e) => e.type === 'activity')).toMatchObject({ activity: 'waiting' });
    const done = events.find((e) => e.type === 'turn.completed') as { status: string; error?: string };
    expect(done.status).toBe('failed');
    expect(done.error).toContain('stopped waiting');
    await provider.stop();
  });

  it('refuses to send before it has been started', async () => {
    const { provider } = makeProvider([init(), success()]);
    await expect(provider.send('hello')).rejects.toThrow('provider not started');
  });

  it('reports the turn as running while it is, and ready once it is done', async () => {
    const { provider, events } = makeProvider([init(), () => new Promise<void>((r) => setTimeout(r, 5)), success()]);
    await start(provider);
    await provider.send('hello');
    expect(provider.isRunning()).toBe(true);
    expect(events.filter((e) => e.type === 'status').at(-1)).toMatchObject({ status: 'running' });
    await waitFor(events, 'turn.completed');
    expect(provider.isRunning()).toBe(false);
    expect(events.filter((e) => e.type === 'status').at(-1)).toMatchObject({ status: 'ready' });
    await provider.stop();
  });
});
