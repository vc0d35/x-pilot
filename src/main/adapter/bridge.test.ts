import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { AdapterBridge, type NavigationDetails } from './bridge';
import { IPC } from '../../shared/ipc';

const spec = { name: 'x_get_page_state', description: 'state', inputSchema: { type: 'object', properties: {} } };

function setup(timeoutMs = 50, staticSpecs = [spec]) {
  const ipc = new EventEmitter();
  const nav = new EventEmitter();
  const sent: Array<{ channel: string; payload: { callId: string; name: string; args: unknown } }> = [];
  const target = {
    id: 7,
    send: (channel: string, payload: never) => { sent.push({ channel, payload }); },
    on: (event: 'did-start-navigation', listener: (details: NavigationDetails) => void) => nav.on(event, listener),
  };
  const warnings: string[] = [];
  const bridge = new AdapterBridge({ on: (ch, l) => { ipc.on(ch, l); } }, target, { timeoutMs, staticSpecs, log: (m) => warnings.push(m) });
  const fromPreload = (channel: string, payload: unknown, senderId = 7) => ipc.emit(channel, { sender: { id: senderId } }, payload);
  const navigate = (details: NavigationDetails) => nav.emit('did-start-navigation', details);
  return { bridge, sent, fromPreload, navigate, warnings };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('AdapterBridge', () => {
  it('lists the compiled specs before the page has registered anything', () => {
    const { bridge } = setup();
    expect(bridge.list()).toEqual([spec]);
  });

  it('accepts registrations from its own webContents only', async () => {
    const { bridge, sent, fromPreload } = setup();
    fromPreload(IPC.adapterRegister, { tools: [spec] }, 99);
    const ignored = bridge.call('x_get_page_state', {});
    await flush();
    expect(sent).toEqual([]);
    fromPreload(IPC.adapterRegister, { tools: [spec] });
    await flush();
    expect(sent).toHaveLength(1);
    fromPreload(IPC.adapterResult, { callId: sent[0].payload.callId, result: { success: true, content: 'ok' } });
    await expect(ignored).resolves.toEqual({ success: true, content: 'ok' });
  });

  it('warns when the page registers a different tool set than the build expects', () => {
    const { fromPreload, warnings } = setup();
    fromPreload(IPC.adapterRegister, { tools: [spec] });
    expect(warnings).toEqual([]);
    fromPreload(IPC.adapterRegister, { tools: [{ ...spec, name: 'x_something_else' }] });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('x_something_else');
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
    await expect(bridge.call('x_not_a_tool', {})).resolves.toEqual({ success: false, error: 'Unknown tool: x_not_a_tool' });
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

  it('keeps the tool list across a navigation', () => {
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

  it('resolves an in-flight call as cancelled when the turn is stopped', async () => {
    const { bridge, sent, fromPreload } = setup(10_000);
    fromPreload(IPC.adapterRegister, { tools: [spec] });
    const ac = new AbortController();
    const p = bridge.call('x_get_page_state', {}, ac.signal);
    await flush();
    expect(sent).toHaveLength(1);
    ac.abort();
    await expect(p).resolves.toEqual({ success: false, error: 'Cancelled' });
  });

  it('does not send a call whose signal is already aborted, and stops waiting for the page', async () => {
    const { bridge, sent, fromPreload } = setup(10_000);
    fromPreload(IPC.adapterRegister, { tools: [spec] });
    await expect(bridge.call('x_get_page_state', {}, AbortSignal.abort())).resolves.toEqual({ success: false, error: 'Cancelled' });
    expect(sent).toEqual([]);
    bridge.markNavigating();
    const ac = new AbortController();
    const waiting = bridge.waitForReady(10_000, ac.signal);
    ac.abort();
    await expect(waiting).rejects.toThrow('Cancelled');
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
