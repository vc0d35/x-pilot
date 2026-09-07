// Fake `codex app-server` used by provider tests. Reads JSONL on stdin, writes JSONL on stdout.
import { createInterface } from 'node:readline';
const out = (m) => process.stdout.write(JSON.stringify(m) + '\n');
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
      setTimeout(() => process.exit(3), 50);
      return;
    }
    if (userText.includes('APPROVE')) {
      out({ jsonrpc: '2.0', id: 'req-approve', method: 'item/commandExecution/requestApproval', params: { threadId, turnId, itemId: 'cmd-1', command: 'ls', cwd: '/tmp' } });
      return; // continues in the response branch below
    }
    out({ jsonrpc: '2.0', method: 'item/started', params: { threadId, turnId, startedAtMs: 0, item: { type: 'dynamicToolCall', id: 'call-1', namespace: null, tool: 'x_get_page_state', arguments: {}, status: 'inProgress', contentItems: null, success: null, durationMs: null } } });
    out({ jsonrpc: '2.0', id: 'req-1', method: 'item/tool/call', params: { threadId, turnId, callId: 'call-1', namespace: null, tool: 'x_get_page_state', arguments: {} } });
    return;
  }
  // responses to our server requests
  if (id === 'req-1') {
    const text = msg.result.contentItems[0].text;
    out({ jsonrpc: '2.0', method: 'item/completed', params: { threadId, turnId: 'turn-1', completedAtMs: 0, item: { type: 'dynamicToolCall', id: 'call-1', namespace: null, tool: 'x_get_page_state', arguments: {}, status: 'completed', contentItems: msg.result.contentItems, success: msg.result.success, durationMs: 1 } } });
    out({ jsonrpc: '2.0', method: 'item/started', params: { threadId, turnId: 'turn-1', startedAtMs: 0, item: { type: 'agentMessage', id: 'msg-1', text: '', phase: null, memoryCitation: null, delivery: null, questions: null } } });
    out({ jsonrpc: '2.0', method: 'item/agentMessage/delta', params: { threadId, turnId: 'turn-1', itemId: 'msg-1', delta: 'You are on: ' } });
    out({ jsonrpc: '2.0', method: 'item/agentMessage/delta', params: { threadId, turnId: 'turn-1', itemId: 'msg-1', delta: text } });
    out({ jsonrpc: '2.0', method: 'item/completed', params: { threadId, turnId: 'turn-1', completedAtMs: 0, item: { type: 'agentMessage', id: 'msg-1', text: 'You are on: ' + text, phase: null, memoryCitation: null, delivery: null, questions: null } } });
    out({ jsonrpc: '2.0', method: 'turn/completed', params: { threadId, turn: { id: 'turn-1', items: [], status: 'completed', error: null } } });
    return;
  }
  if (id === 'req-approve') {
    out({ jsonrpc: '2.0', method: 'item/completed', params: { threadId, turnId: 'turn-1', completedAtMs: 0, item: { type: 'agentMessage', id: 'msg-2', text: 'decision=' + msg.result.decision, phase: null, memoryCitation: null, delivery: null, questions: null } } });
    out({ jsonrpc: '2.0', method: 'turn/completed', params: { threadId, turn: { id: 'turn-1', items: [], status: 'completed', error: null } } });
  }
});
