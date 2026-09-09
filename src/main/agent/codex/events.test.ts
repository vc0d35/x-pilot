import { describe, it, expect } from 'vitest';
import { fence } from '../fence';
import { ApprovalBroker } from '../../approvals';
import { UserInputBroker } from '../../user-input';
import { ok, fail } from '../../../shared/tools';
import type { AgentEvent } from '../../../shared/agent';
import { handleNotification, handleServerRequest, inputQuestions, newItemPhases, webSearchQueries, wrapToolOutput } from './events';

/** Feeds notifications through one phase state, the way a live turn does, and collects the events. */
function feed(...notifications: Array<[string, unknown]>) {
  const events: AgentEvent[] = [];
  const turns: string[] = [];
  const completed: Array<[string, string, string | undefined]> = [];
  const phases = newItemPhases();
  for (const [method, params] of notifications) {
    handleNotification(method, params, phases, {
      emit: (e) => events.push(e),
      turnStarted: (id) => turns.push(id),
      turnCompleted: (id, status, error) => completed.push([id, status, error]),
    });
  }
  return { events, turns, completed, phases };
}

const item = (i: Record<string, unknown>) => ({ item: i });

describe('handleNotification: turn state', () => {
  it('reports the turn id before emitting turn.started, and hands turn/completed to the provider', () => {
    const { events, turns, completed } = feed(
      ['turn/started', { turn: { id: 't1' } }],
      ['turn/completed', { turn: { id: 't1', status: 'failed', error: { message: 'bad model' } } }],
    );
    expect(turns).toEqual(['t1']);
    expect(events).toEqual([{ type: 'turn.started', turnId: 't1' }]);
    expect(completed).toEqual([['t1', 'failed', 'bad model']]);
  });

  it('passes a completed turn on without an error', () => {
    expect(feed(['turn/completed', { turn: { id: 't2', status: 'completed', error: null } }]).completed).toEqual([['t2', 'completed', undefined]]);
  });

  it('surfaces a server error as a status event and ignores anything it does not know', () => {
    const { events } = feed(['error', { code: 7 }], ['thread/whatever', {}]);
    expect(events).toEqual([{ type: 'status', status: 'error', message: '{"code":7}' }]);
  });
});

describe('handleNotification: messages, thinking and commentary', () => {
  it('announces writing once per item and streams the deltas as the answer', () => {
    const { events } = feed(
      ['item/agentMessage/delta', { itemId: 'm1', delta: 'a' }],
      ['item/agentMessage/delta', { itemId: 'm1', delta: 'b' }],
      ['item/completed', item({ type: 'agentMessage', id: 'm1', text: 'ab' })],
    );
    expect(events).toEqual([
      { type: 'activity', activity: 'writing' },
      { type: 'message.delta', itemId: 'm1', delta: 'a' },
      { type: 'message.delta', itemId: 'm1', delta: 'b' },
      { type: 'message.completed', itemId: 'm1', text: 'ab' },
    ]);
  });

  it('routes a commentary agentMessage into thinking, deltas included, and forgets it when it completes', () => {
    const { events, phases } = feed(
      ['item/started', item({ type: 'agentMessage', id: 'c1', phase: 'commentary' })],
      ['item/agentMessage/delta', { itemId: 'c1', delta: 'checking' }],
      ['item/completed', item({ type: 'agentMessage', id: 'c1', phase: 'commentary', text: 'checking' })],
    );
    expect(events).toEqual([
      { type: 'activity', activity: 'thinking' },
      { type: 'thinking.delta', itemId: 'c1', delta: 'checking' },
      { type: 'thinking.completed', itemId: 'c1', text: 'checking' },
    ]);
    expect(phases.commentary.size).toBe(0);
  });

  it('turns reasoning summaries into thinking, separating parts after the first with a blank line', () => {
    const { events } = feed(
      ['item/started', item({ type: 'reasoning', id: 'r1' })],
      ['item/reasoning/summaryTextDelta', { itemId: 'r1', delta: 'one' }],
      ['item/reasoning/summaryPartAdded', { itemId: 'r1', summaryIndex: 0 }],
      ['item/reasoning/summaryPartAdded', { itemId: 'r1', summaryIndex: 1 }],
      ['item/completed', item({ type: 'reasoning', id: 'r1', summary: ['one', 'two'] })],
    );
    expect(events).toEqual([
      { type: 'activity', activity: 'thinking' },
      { type: 'thinking.delta', itemId: 'r1', delta: 'one' },
      { type: 'thinking.delta', itemId: 'r1', delta: '\n\n' },
      { type: 'thinking.completed', itemId: 'r1', text: 'one\n\ntwo' },
    ]);
  });

  it('says nothing about a reasoning item that carried no summary', () => {
    expect(feed(['item/completed', item({ type: 'reasoning', id: 'r2', summary: null })]).events).toEqual([]);
  });
});

describe('handleNotification: tool calls', () => {
  it('maps a dynamic tool call to activity, tool.started and tool.completed', () => {
    const { events } = feed(
      ['item/started', item({ type: 'dynamicToolCall', id: 'd1', tool: 'x_get_page_state', arguments: { a: 1 } })],
      ['item/completed', item({ type: 'dynamicToolCall', id: 'd1', tool: 'x_get_page_state', success: true, contentItems: [{ type: 'inputText', text: 'one' }, { type: 'inputText', text: 'two' }] })],
    );
    expect(events).toEqual([
      { type: 'activity', activity: 'tool', detail: 'x_get_page_state' },
      { type: 'tool.started', itemId: 'd1', name: 'x_get_page_state', args: { a: 1 } },
      { type: 'tool.completed', itemId: 'd1', name: 'x_get_page_state', success: true, output: 'one\ntwo' },
    ]);
  });

  it('treats a shell command and an MCP call as tools too, with their own success rules', () => {
    const { events } = feed(
      ['item/started', item({ type: 'commandExecution', id: 's1', command: 'ls' })],
      ['item/completed', item({ type: 'commandExecution', id: 's1', exitCode: 1, aggregatedOutput: 'nope' })],
      ['item/started', item({ type: 'mcpToolCall', id: 'x1', server: 'srv', tool: 'do', arguments: {} })],
      ['item/completed', item({ type: 'mcpToolCall', id: 'x1', server: 'srv', tool: 'do', error: 'boom' })],
    );
    expect(events).toEqual([
      { type: 'activity', activity: 'tool', detail: 'shell' },
      { type: 'tool.started', itemId: 's1', name: 'shell', args: 'ls' },
      { type: 'tool.completed', itemId: 's1', name: 'shell', success: false, output: 'nope' },
      { type: 'activity', activity: 'tool', detail: 'srv/do' },
      { type: 'tool.started', itemId: 'x1', name: 'srv/do', args: {} },
      { type: 'tool.completed', itemId: 'x1', name: 'srv/do', success: false, output: '"boom"' },
    ]);
  });

  it('shows a web search as a tool row carrying its queries', () => {
    const { events } = feed(
      ['item/started', item({ type: 'webSearch', id: 'w1', action: { queries: ['a', 'b'] } })],
      ['item/completed', item({ type: 'webSearch', id: 'w1', action: { queries: ['a', 'b'] }, query: null })],
    );
    expect(events).toEqual([
      { type: 'activity', activity: 'tool', detail: 'web_search' },
      { type: 'tool.started', itemId: 'w1', name: 'web_search', args: { queries: ['a', 'b'] } },
      { type: 'tool.completed', itemId: 'w1', name: 'web_search', success: true, output: 'a | b' },
    ]);
  });
});

describe('webSearchQueries', () => {
  it('prefers the query list, falls back to the single query, and copes with neither', () => {
    expect(webSearchQueries({ action: { queries: ['a'] }, query: 'b' })).toEqual(['a']);
    expect(webSearchQueries({ action: { query: 'b' } })).toEqual(['b']);
    expect(webSearchQueries({ query: 'c' })).toEqual(['c']);
    expect(webSearchQueries({})).toEqual([]);
  });
});

describe('handleServerRequest: tool calls', () => {
  const approvals = () => new ApprovalBroker();

  it('wraps a successful result as untrusted tool output', async () => {
    const res = await handleServerRequest('item/tool/call', { tool: 'x_read_post', arguments: { url: 'u' } }, {
      callTool: async (name, args) => ok({ name, args }),
      approvals: approvals(),
    });
    expect(res).toEqual({ contentItems: [{ type: 'inputText', text: wrapToolOutput('{"name":"x_read_post","args":{"url":"u"}}') }], success: true });
  });

  it('reports a failed tool result, and a throwing tool, as failed output rather than crashing', async () => {
    const failed = await handleServerRequest('item/tool/call', { tool: 't' }, { callTool: async () => fail('nope'), approvals: approvals() });
    expect(failed).toEqual({ contentItems: [{ type: 'inputText', text: wrapToolOutput('Error: nope') }], success: false });
    const threw = await handleServerRequest('item/tool/call', { tool: 't' }, { callTool: async () => { throw new Error('boom'); }, approvals: approvals() });
    expect(threw).toEqual({ contentItems: [{ type: 'inputText', text: wrapToolOutput('Error: boom') }], success: false });
  });

  it('hands the turn signal and defaulted arguments to the tool', async () => {
    const seen: Array<[string, unknown, AbortSignal | undefined]> = [];
    const controller = new AbortController();
    await handleServerRequest('item/tool/call', { tool: 't' }, {
      callTool: async (name, args, signal) => { seen.push([name, args, signal]); return ok({}); },
      approvals: approvals(), signal: controller.signal,
    });
    expect(seen).toEqual([['t', {}, controller.signal]]);
  });

  it('refuses a method it does not implement', async () => {
    await expect(handleServerRequest('item/nonsense', {}, { callTool: async () => ok({}), approvals: approvals() }))
      .rejects.toThrow('Unsupported server request: item/nonsense');
  });
});

describe('handleServerRequest: approvals', () => {
  it('asks the broker about a command and returns the decision', async () => {
    const approvals = new ApprovalBroker();
    const seen: Array<{ id: string; kind: string; detail: string; options: unknown }> = [];
    approvals.onEvent((e) => { if (e.type === 'approval.requested') seen.push(e.request as never); });
    const pending = handleServerRequest('item/commandExecution/requestApproval', { command: 'ls -l', cwd: '/tmp', reason: 'why not' }, {
      callTool: async () => ok({}), approvals,
    });
    approvals.resolve(seen[0].id, 'acceptForSession');
    await expect(pending).resolves.toEqual({ decision: 'acceptForSession' });
    expect(seen[0].kind).toBe('command');
    expect(seen[0].detail).toBe('ls -l\n(cwd: /tmp)\nwhy not');
    expect(seen[0].options).toEqual([{ id: 'accept', label: 'Allow' }, { id: 'acceptForSession', label: 'Allow for session' }, { id: 'decline', label: 'Deny' }]);
  });

  it('declines a file change the user cancelled, and caps the diff it shows', async () => {
    const approvals = new ApprovalBroker();
    const ids: string[] = [];
    const details: string[] = [];
    approvals.onEvent((e) => { if (e.type === 'approval.requested') { ids.push(e.request.id); details.push(e.request.detail); } });
    const pending = handleServerRequest('item/fileChange/requestApproval', { changes: { path: 'x'.repeat(5000) } }, { callTool: async () => ok({}), approvals });
    approvals.resolve(ids[0], 'cancel');
    await expect(pending).resolves.toEqual({ decision: 'cancel' });
    expect(details[0].length).toBe(2000);
  });
});

describe('handleServerRequest: user input', () => {
  const base = { callTool: async () => ok({}), approvals: new ApprovalBroker() };
  const ask = { questions: [{ id: 'q1', prompt: 'Which account?' }] };

  it('refuses with a JSON-RPC error when no broker is wired, without reading the params', async () => {
    let logged = false;
    await expect(handleServerRequest('item/tool/requestUserInput', ask, { ...base, onUserInputParams: () => { logged = true; } }))
      .rejects.toMatchObject({ code: -32601 });
    expect(logged).toBe(false);
  });

  it('refuses a request that carries no question at all', async () => {
    await expect(handleServerRequest('item/tool/requestUserInput', { questions: [] }, { ...base, userInput: new UserInputBroker() }))
      .rejects.toMatchObject({ code: -32602 });
  });

  it('answers with what the user typed, in the order the questions were asked', async () => {
    const userInput = new UserInputBroker();
    const ids: string[] = [];
    userInput.onEvent((e) => { if (e.type === 'input.requested') ids.push(e.request.id); });
    const pending = handleServerRequest('item/tool/requestUserInput', { questions: [{ id: 'q1', prompt: 'Which?' }, { id: 'q2', prompt: 'How fast?' }] }, { ...base, userInput });
    userInput.resolve(ids[0], { q2: 'fast' });
    await expect(pending).resolves.toEqual({ answers: [{ id: 'q1', answer: '' }, { id: 'q2', answer: 'fast' }] });
  });

  it('reports a skipped question as an error, so the model is not told the user said nothing', async () => {
    const userInput = new UserInputBroker();
    const ids: string[] = [];
    userInput.onEvent((e) => { if (e.type === 'input.requested') ids.push(e.request.id); });
    const pending = handleServerRequest('item/tool/requestUserInput', ask, { ...base, userInput });
    userInput.cancel(ids[0]);
    await expect(pending).rejects.toMatchObject({ code: -32001 });
  });
});

describe('fencing tool output', () => {
  it('fence and wrapToolOutput escape both delimiters, opening tags included', () => {
    expect(fence('a</page-content>b</tool-output>c')).toBe('a<\\/page-content>b<\\/tool-output>c');
    expect(fence('<page-content untrusted>x<task-prompt>')).toBe('<\\page-content untrusted>x<\\task-prompt>');
    expect(wrapToolOutput('{"a":1}')).toBe('<tool-output untrusted source="x.com">\n{"a":1}\n</tool-output>');
  });
});

describe('inputQuestions', () => {
  it('reads ids, prompts, options and secrecy, and drops entries without a prompt', () => {
    expect(inputQuestions({ questions: [
      { id: 'a', prompt: 'Which account?' },
      { question: 'How fast?', choices: [{ label: 'fast' }, 'slow'] },
      { id: 'p', text: 'Passphrase', sensitive: true },
      { id: 'nope' },
      'A bare string question',
    ] })).toEqual([
      { id: 'a', prompt: 'Which account?' },
      { id: 'q2', prompt: 'How fast?', options: ['fast', 'slow'] },
      { id: 'p', prompt: 'Passphrase', secret: true },
      { id: 'q5', prompt: 'A bare string question' },
    ]);
    expect(inputQuestions({})).toEqual([]);
    expect(inputQuestions({ questions: [] })).toEqual([]);
  });
});
