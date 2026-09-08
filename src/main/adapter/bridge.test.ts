import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { AdapterBridge, type NavigationDetails } from './bridge';
import { IPC } from '../../shared/ipc';

function setup(timeoutMs = 50) {
  const ipc = new EventEmitter();
  const nav = new EventEmitter();
  const sent: Array<{ channel: string; payload: { callId: string; name: string; args: unknown } }> = [];
  const target = {
    id: 7,
    send: (channel: string, payload: never) => { sent.push({ channel, payload }); },
    on: (event: 'did-start-navigation', listener: (details: NavigationDetails) => void) => nav.on(event, listener),
  };
  const bridge = new AdapterBridge({ on: (ch, l) => { ipc.on(ch, l); } }, target, timeoutMs);
  const fromPreload = (channel: string, payload: unknown, senderId = 7) => ipc.emit(channel, { sender: { id: senderId } }, payload);
  const navigate = (details: NavigationDetails) => nav.emit('did-start-navigation', details);
  return { bridge, sent, fromPreload, navigate };
}

const spec = { name: 'x_get_page_state', description: 'state', inputSchema: { type: 'object', properties: {} } };
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('AdapterBridge', () => {
  it('stores registrations from its own webContents only', () => {
    const { bridge, fromPreload } = setup();
    fromPreload(IPC.adapterRegister, { tools: [spec] }, 99);
    expect(bridge.list()).toEqual([]);
    fromPreload(IPC.adapterRegister, { tools: [spec] });
    expect(bridge.list()).toEqual([spec]);
  });

  it('sends a call and resolves on result', async () => {
    const { bridge, sent, fromPreload } = setup();
    fromPreload(IPC.adapterRegister, { tools: [spec] });
    const p = bridge.call('x_get_page_state', { a: 1 });
    await flush();
    expect(sent[0].channel).toBe(IPC.adapterCall);
    expect(sent[0].payload).toMatchObject({ name: 'x_get_page_state', args: { a: 1 } });
    fromPreload(IPC.adapterResult, { callId: sent[0].payload.callId, result: { success: true, content: 'ok' } });
    await expect(p).resolves.toEqual({ success: true, content: 'ok' });
  });

  it('fails on timeout and unknown tools', async () => {
    const { bridge, fromPreload } = setup(20);
    await expect(bridge.call('x_get_page_state', {})).resolves.toEqual({ success: false, error: 'Unknown tool: x_get_page_state' });
    fromPreload(IPC.adapterRegister, { tools: [spec] });
    await expect(bridge.call('x_get_page_state', {})).resolves.toEqual({ success: false, error: 'Adapter tool call timed out: x_get_page_state' });
  });

  it('waitForReady resolves on the next registration after markNavigating', async () => {
    const { bridge, fromPreload } = setup();
    fromPreload(IPC.adapterRegister, { tools: [spec] });
    await expect(bridge.waitForReady(10)).resolves.toBeUndefined();
    bridge.markNavigating();
    await expect(bridge.waitForReady(10)).rejects.toThrow('X view did not register tools');
    const p = bridge.waitForReady(100);
    fromPreload(IPC.adapterRegister, { tools: [spec] });
    await expect(p).resolves.toBeUndefined();
  });

  it('keeps the last-known tool list across a navigation', () => {
    const { bridge, fromPreload, navigate } = setup();
    fromPreload(IPC.adapterRegister, { tools: [spec] });
    bridge.markNavigating();
    expect(bridge.list()).toEqual([spec]);
    navigate({ isMainFrame: true, isSameDocument: false });
    expect(bridge.list()).toEqual([spec]);
  });

  it('holds a call until the page re-registers', async () => {
    const { bridge, sent, fromPreload } = setup();
    fromPreload(IPC.adapterRegister, { tools: [spec] });
    bridge.markNavigating();
    const p = bridge.call('x_get_page_state', {});
    await flush();
    expect(sent).toEqual([]);
    fromPreload(IPC.adapterRegister, { tools: [spec] });
    await flush();
    expect(sent).toHaveLength(1);
    fromPreload(IPC.adapterResult, { callId: sent[0].payload.callId, result: { success: true, content: 'ok' } });
    await expect(p).resolves.toEqual({ success: true, content: 'ok' });
  });

  it('fails a call clearly when the page never comes back', async () => {
    vi.useFakeTimers();
    try {
      const { bridge, sent, fromPreload } = setup();
      fromPreload(IPC.adapterRegister, { tools: [spec] });
      bridge.markNavigating();
      const p = bridge.call('x_get_page_state', {});
      await vi.advanceTimersByTimeAsync(10_000);
      expect(sent).toEqual([]);
      await expect(p).resolves.toEqual({ success: false, error: 'The page is still loading and did not register its tools; x_get_page_state was not run. Retry once it has loaded.' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails in-flight calls when the user navigates away', async () => {
    const { bridge, fromPreload, navigate } = setup();
    fromPreload(IPC.adapterRegister, { tools: [spec] });
    const p = bridge.call('x_get_page_state', {});
    await flush();
    navigate({ isMainFrame: true, isSameDocument: false });
    await expect(p).resolves.toEqual({ success: false, error: 'The page navigated during the call; retry once it has loaded' });
  });

  it('ignores subframe and same-document navigations', async () => {
    const { bridge, fromPreload, navigate } = setup();
    fromPreload(IPC.adapterRegister, { tools: [spec] });
    const p = bridge.call('x_get_page_state', {});
    await flush();
    navigate({ isMainFrame: false, isSameDocument: false });
    navigate({ isMainFrame: true, isSameDocument: true });
    await expect(bridge.waitForReady(10)).resolves.toBeUndefined();
    await expect(p).resolves.toEqual({ success: false, error: 'Adapter tool call timed out: x_get_page_state' });
  });
});
