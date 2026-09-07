import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { WebMcpBridge } from './bridge';
import { IPC } from '../../shared/ipc';

function setup(timeoutMs = 50) {
  const ipc = new EventEmitter();
  const sent: Array<{ channel: string; payload: { callId: string; name: string; args: unknown } }> = [];
  const target = { id: 7, send: (channel: string, payload: never) => { sent.push({ channel, payload }); } };
  const bridge = new WebMcpBridge({ on: (ch, l) => { ipc.on(ch, l); } }, target, timeoutMs);
  const fromPreload = (channel: string, payload: unknown, senderId = 7) => ipc.emit(channel, { sender: { id: senderId } }, payload);
  return { bridge, sent, fromPreload };
}

const spec = { name: 'x_get_page_state', description: 'state', inputSchema: { type: 'object', properties: {} } };

describe('WebMcpBridge', () => {
  it('stores registrations from its own webContents only', () => {
    const { bridge, fromPreload } = setup();
    fromPreload(IPC.webmcpRegister, { tools: [spec] }, 99);
    expect(bridge.list()).toEqual([]);
    fromPreload(IPC.webmcpRegister, { tools: [spec] });
    expect(bridge.list()).toEqual([spec]);
  });

  it('sends a call and resolves on result', async () => {
    const { bridge, sent, fromPreload } = setup();
    fromPreload(IPC.webmcpRegister, { tools: [spec] });
    const p = bridge.call('x_get_page_state', { a: 1 });
    expect(sent[0].channel).toBe(IPC.webmcpCall);
    expect(sent[0].payload).toMatchObject({ name: 'x_get_page_state', args: { a: 1 } });
    fromPreload(IPC.webmcpResult, { callId: sent[0].payload.callId, result: { success: true, content: 'ok' } });
    await expect(p).resolves.toEqual({ success: true, content: 'ok' });
  });

  it('fails on timeout and unknown tools', async () => {
    const { bridge, fromPreload } = setup(20);
    await expect(bridge.call('x_get_page_state', {})).resolves.toEqual({ success: false, error: 'Unknown tool: x_get_page_state' });
    fromPreload(IPC.webmcpRegister, { tools: [spec] });
    await expect(bridge.call('x_get_page_state', {})).resolves.toEqual({ success: false, error: 'Page tool call timed out: x_get_page_state' });
  });

  it('waitForReady resolves on the next registration after markNavigating', async () => {
    const { bridge, fromPreload } = setup();
    fromPreload(IPC.webmcpRegister, { tools: [spec] });
    await expect(bridge.waitForReady(10)).resolves.toBeUndefined();
    bridge.markNavigating();
    await expect(bridge.waitForReady(10)).rejects.toThrow('X view did not register tools');
    const p = bridge.waitForReady(100);
    fromPreload(IPC.webmcpRegister, { tools: [spec] });
    await expect(p).resolves.toBeUndefined();
  });
});
