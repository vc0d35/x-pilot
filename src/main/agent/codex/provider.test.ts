import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CodexProvider, buildTurnText } from './provider';
import { ApprovalBroker } from '../../approvals';
import { ok } from '../../../shared/tools';
import type { AgentEvent } from '../../../shared/agent';
import { DEFAULT_SETTINGS } from '../../../shared/settings';

const FAKE = fileURLToPath(new URL('./fake-codex.mjs', import.meta.url));

function makeProvider() {
  const approvals = new ApprovalBroker();
  const stderr: string[] = [];
  const provider = new CodexProvider({
    callTool: async (name) => ok({ url: 'https://x.com/home', tool: name }),
    approvals,
    spawn: () => { const p = spawn(process.execPath, [FAKE]); p.stderr.on('data', (d) => stderr.push(String(d))); return p; },
  });
  const events: AgentEvent[] = [];
  provider.onEvent((e) => events.push(e));
  approvals.onEvent((e) => events.push(e));
  return { provider, approvals, events, stderr };
}

const waitFor = async (events: AgentEvent[], type: AgentEvent['type'], ms = 3000) => {
  const start = Date.now();
  while (!events.some((e) => e.type === type)) {
    if (Date.now() - start > ms) throw new Error(`timeout waiting for ${type}`);
    await new Promise((r) => setTimeout(r, 10));
  }
};

const tools = [{ name: 'x_get_page_state', description: 'state', inputSchema: { type: 'object', properties: {} } }];

describe('CodexProvider', () => {
  it('starts a thread passing dynamic tools and answers tool calls', async () => {
    const { provider, events, stderr } = makeProvider();
    const { threadId } = await provider.start({ tools, settings: DEFAULT_SETTINGS.agent.codex, workspaceDir: '/tmp' });
    expect(threadId).toBe('thread-1');
    expect(stderr.join('')).toContain('"name":"x_get_page_state"');
    await provider.send('What page?');
    await waitFor(events, 'turn.completed');
    const types = events.map((e) => e.type);
    expect(types).toContain('tool.started');
    expect(types).toContain('tool.completed');
    const done = events.find((e) => e.type === 'message.completed') as { text: string };
    expect(done.text).toContain('"url":"https://x.com/home"');
    const deltas = events.filter((e) => e.type === 'message.delta').map((e) => (e as { delta: string }).delta).join('');
    expect(deltas.startsWith('You are on: ')).toBe(true);
    expect(provider.isRunning()).toBe(false);
    await provider.stop();
  });

  it('routes command approvals through the broker', async () => {
    const { provider, approvals, events } = makeProvider();
    await provider.start({ tools, settings: DEFAULT_SETTINGS.agent.codex, workspaceDir: '/tmp' });
    await provider.send('please APPROVE');
    await waitFor(events, 'approval.requested');
    const req = (events.find((e) => e.type === 'approval.requested') as { request: { id: string; kind: string } }).request;
    expect(req.kind).toBe('command');
    approvals.resolve(req.id, 'accept');
    await waitFor(events, 'turn.completed');
    const msg = events.find((e) => e.type === 'message.completed') as { text: string };
    expect(msg.text).toBe('decision=accept');
    await provider.stop();
  });

  it('lists models', async () => {
    const { provider } = makeProvider();
    await provider.start({ tools, settings: DEFAULT_SETTINGS.agent.codex, workspaceDir: '/tmp' });
    await expect(provider.listModels()).resolves.toEqual([{ id: 'fake-model', displayName: 'Fake', isDefault: true, reasoningEfforts: ['low', 'high'] }]);
    await provider.stop();
  });

  it('emits disconnected when the process dies', async () => {
    const { provider, events } = makeProvider();
    await provider.start({ tools, settings: DEFAULT_SETTINGS.agent.codex, workspaceDir: '/tmp' });
    await provider.stop();
    const start = Date.now();
    while (!events.some((e) => e.type === 'status' && e.status === 'disconnected')) {
      if (Date.now() - start > 3000) throw new Error('no disconnected status');
      await new Promise((r) => setTimeout(r, 10));
    }
  });
});

describe('buildTurnText', () => {
  const ctx = { url: 'https://x.com/a/status/1', post: { id: '1', url: 'https://x.com/a/status/1', authorHandle: 'a', authorName: 'A', text: 'hello world', postedAt: null, kind: 'post' as const } };
  it('includes the full post when the focus changed', () => {
    const t = buildTurnText('is this true?', ctx, null);
    expect(t).toContain('Current page: post by @a at https://x.com/a/status/1');
    expect(t).toContain('hello world');
    expect(t.endsWith('is this true?')).toBe(true);
  });
  it('sends a one-line reference when the focus is unchanged', () => {
    const t = buildTurnText('and this?', ctx, '1');
    expect(t).toBe('Current page: still the post by @a at https://x.com/a/status/1\n\nand this?');
  });
  it('passes text through without context', () => {
    expect(buildTurnText('hi', null, null)).toBe('hi');
  });
});
