// Fake `codex app-server` used by provider tests. Reads JSONL on stdin, writes JSONL on stdout.
import { createInterface } from 'node:readline';
const out = (m) => process.stdout.write(JSON.stringify(m) + '\n');
if (process.argv.includes('ignore-sigterm')) process.on('SIGTERM', () => {});
const rl = createInterface({ input: process.stdin });
let threadId = 'thread-1';
rl.on('line', async (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  const { id, method, params } = msg;
  if (method === 'initialize') return out({ jsonrpc: '2.0', id, result: { userAgent: 'fake/1', codexHome: '/tmp', platformFamily: 'unix', platformOs: 'macos' } });
  if (method === 'initialized') return;
  if (method === 'thread/start') {
    process.stderr.write('DYN:' + JSON.stringify(params.dynamicTools) + '\n');
    process.stderr.write('CFG:' + JSON.stringify(params.config ?? null) + '\n');
    return out({ jsonrpc: '2.0', id, result: { thread: { id: threadId }, model: params.model ?? 'fake-model', modelProvider: 'openai', serviceTier: null, cwd: params.cwd, instructionSources: [], approvalPolicy: 'never', approvalsReviewer: 'user', sandbox: { type: 'readOnly' }, reasoningEffort: null } });
  }
  if (method === 'thread/resume') return out({ jsonrpc: '2.0', id, result: { thread: { id: params.threadId }, model: 'fake-model' } });
  if (method === 'model/list') return out({ jsonrpc: '2.0', id, result: { data: [{ id: 'fake-model', model: 'fake-model', displayName: 'Fake', isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }] }], nextCursor: null } });
  if (method === 'turn/interrupt') return out({ jsonrpc: '2.0', id, result: {} });
  if (method === 'turn/start') {
    const turnId = 'turn-1';
    const userText = params.input[0].text;
    if (userText.includes('DIE_EARLY')) {
      process.exit(4);
      return;
    }
    if (userText.includes('REJECT_TURN')) {
      return out({ jsonrpc: '2.0', id, error: { code: -32000, message: 'bad model' } });
    }
    out({ jsonrpc: '2.0', id, result: { turn: { id: turnId, items: [], status: 'inProgress' } } });
    out({ jsonrpc: '2.0', method: 'turn/started', params: { threadId, turn: { id: turnId, items: [], status: 'inProgress' } } });
    if (userText.includes('DIE')) {
      out({ jsonrpc: '2.0', id: 'req-die', method: 'item/commandExecution/requestApproval', params: { threadId, turnId, itemId: 'cmd-die', command: 'ls', cwd: '/tmp' } });
      // The client never answers an approval on its own, so ping it with a request it does
      // answer: its reply proves the (line-ordered) approval above was already dispatched, and
      // we can die deterministically instead of on a racy timer.
      out({ jsonrpc: '2.0', id: 'req-die-ack', method: 'item/tool/requestUserInput', params: { threadId, turnId, itemId: 'cmd-die', questions: [] } });
      return;
    }
    if (userText.includes('PANIC_EXIT')) {
      process.stderr.write('Error: codex panicked at src/main.rs:42\n  stack frame one\n', () => process.exit(9));
      return;
    }
    if (userText.includes('ASK_INPUT')) {
      out({ jsonrpc: '2.0', id: 'req-input', method: 'item/tool/requestUserInput', params: { threadId, turnId, itemId: 'ask-1', questions: [{ id: 'q1', prompt: 'Which account?' }] } });
      return;
    }
    if (userText.includes('APPROVE')) {
      out({ jsonrpc: '2.0', id: 'req-approve', method: 'item/commandExecution/requestApproval', params: { threadId, turnId, itemId: 'cmd-1', command: 'ls', cwd: '/tmp' } });
      return; // continues in the response branch below
    }
    out({ jsonrpc: '2.0', method: 'item/started', params: { threadId, turnId, startedAtMs: 0, item: { type: 'reasoning', id: 'r-1', summary: [], content: [] } } });
    out({ jsonrpc: '2.0', method: 'item/reasoning/summaryTextDelta', params: { threadId, turnId, itemId: 'r-1', delta: 'Need the page ', summaryIndex: 0 } });
    out({ jsonrpc: '2.0', method: 'item/reasoning/summaryTextDelta', params: { threadId, turnId, itemId: 'r-1', delta: 'state first.', summaryIndex: 0 } });
    out({ jsonrpc: '2.0', method: 'item/completed', params: { threadId, turnId, completedAtMs: 0, item: { type: 'reasoning', id: 'r-1', summary: ['Need the page state first.'], content: [] } } });
    out({ jsonrpc: '2.0', method: 'item/started', params: { threadId, turnId, startedAtMs: 0, item: { type: 'agentMessage', id: 'c-1', text: '', phase: 'commentary', memoryCitation: null, delivery: null, questions: null } } });
    out({ jsonrpc: '2.0', method: 'item/agentMessage/delta', params: { threadId, turnId, itemId: 'c-1', delta: "I'll check the page." } });
    out({ jsonrpc: '2.0', method: 'item/completed', params: { threadId, turnId, completedAtMs: 0, item: { type: 'agentMessage', id: 'c-1', text: "I'll check the page.", phase: 'commentary', memoryCitation: null, delivery: null, questions: null } } });
    // A built-in web search the model ran before calling our tool.
    const ws = { type: 'webSearch', id: 'ws-1', query: 'electron latest version', action: { type: 'search', query: null, queries: ['electron latest version', 'electron releases'] } };
    out({ jsonrpc: '2.0', method: 'item/started', params: { threadId, turnId, startedAtMs: 0, item: ws } });
    out({ jsonrpc: '2.0', method: 'item/completed', params: { threadId, turnId, completedAtMs: 0, item: ws } });
    out({ jsonrpc: '2.0', method: 'item/started', params: { threadId, turnId, startedAtMs: 0, item: { type: 'dynamicToolCall', id: 'call-1', namespace: null, tool: 'x_get_page_state', arguments: {}, status: 'inProgress', contentItems: null, success: null, durationMs: null } } });
    out({ jsonrpc: '2.0', id: 'req-1', method: 'item/tool/call', params: { threadId, turnId, callId: 'call-1', namespace: null, tool: 'x_get_page_state', arguments: {} } });
    return;
  }
  // responses to our server requests
  if (id === 'req-die-ack') return process.exit(3);
  if (id === 'req-input') {
    out({ jsonrpc: '2.0', method: 'item/completed', params: { threadId, turnId: 'turn-1', completedAtMs: 0, item: { type: 'agentMessage', id: 'msg-3', text: 'input-reply=' + JSON.stringify(msg.error ?? msg.result ?? null), phase: null, memoryCitation: null, delivery: null, questions: null } } });
    out({ jsonrpc: '2.0', method: 'turn/completed', params: { threadId, turn: { id: 'turn-1', items: [], status: 'completed', error: null } } });
    return;
  }
  if (id === 'req-1') {
    const text = msg.result.contentItems[0].text;
    out({ jsonrpc: '2.0', method: 'item/completed', params: { threadId, turnId: 'turn-1', completedAtMs: 0, item: { type: 'dynamicToolCall', id: 'call-1', namespace: null, tool: 'x_get_page_state', arguments: {}, status: 'completed', contentItems: msg.result.contentItems, success: msg.result.success, durationMs: 1 } } });
    out({ jsonrpc: '2.0', method: 'item/started', params: { threadId, turnId: 'turn-1', startedAtMs: 0, item: { type: 'agentMessage', id: 'msg-1', text: '', phase: 'final_answer', memoryCitation: null, delivery: null, questions: null } } });
    out({ jsonrpc: '2.0', method: 'item/agentMessage/delta', params: { threadId, turnId: 'turn-1', itemId: 'msg-1', delta: 'You are on: ' } });
    out({ jsonrpc: '2.0', method: 'item/agentMessage/delta', params: { threadId, turnId: 'turn-1', itemId: 'msg-1', delta: text } });
    out({ jsonrpc: '2.0', method: 'item/completed', params: { threadId, turnId: 'turn-1', completedAtMs: 0, item: { type: 'agentMessage', id: 'msg-1', text: 'You are on: ' + text, phase: 'final_answer', memoryCitation: null, delivery: null, questions: null } } });
    out({ jsonrpc: '2.0', method: 'turn/completed', params: { threadId, turn: { id: 'turn-1', items: [], status: 'completed', error: null } } });
    return;
  }
  if (id === 'req-approve') {
    out({ jsonrpc: '2.0', method: 'item/completed', params: { threadId, turnId: 'turn-1', completedAtMs: 0, item: { type: 'agentMessage', id: 'msg-2', text: 'decision=' + msg.result.decision, phase: null, memoryCitation: null, delivery: null, questions: null } } });
    out({ jsonrpc: '2.0', method: 'turn/completed', params: { threadId, turn: { id: 'turn-1', items: [], status: 'completed', error: null } } });
  }
});
