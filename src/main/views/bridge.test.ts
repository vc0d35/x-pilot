import { describe, it, expect, vi } from 'vitest';
import { IPC } from '../../shared/ipc';
import { ok } from '../../shared/tools';
import {
  VIEW_CALLS_PER_WINDOW,
  VIEW_DRIVER_TOOLS,
  VIEW_ACCOUNT_WRITE_TOOLS,
  VIEW_READ_TOOLS,
  VIEW_TOOL_ALLOWLIST,
} from '../../shared/views';
import type { AgentEvent } from '../../shared/agent';
import type { PageContext } from '../../shared/page';
import { refuseToolCall, registerViewBridgeIpc, type ViewBridgeIpc } from './bridge';

const CANVAS_ID = 7;

const context = (visible: PageContext['visible'] = []): PageContext => ({
  url: 'https://x.com/home',
  kind: 'home',
  post: null,
  visible,
});

function harness(opts: { canvasId?: number | null; context?: PageContext | null; now?: () => number; previewing?: boolean } = {}) {
  const handlers = new Map<string, (event: { sender: { id: number } }, payload: unknown) => unknown>();
  const listeners = new Map<string, (event: { sender: { id: number } }, payload: unknown) => void>();
  const ipc: ViewBridgeIpc = {
    handle: (channel, listener) => handlers.set(channel, listener),
    on: (channel, listener) => listeners.set(channel, listener),
  };
  const sent: { feed: string; data: unknown }[] = [];
  const callTool = vi.fn(async (name: string) => ok({ called: name }));
  const deactivate = vi.fn();
  const traced: AgentEvent[] = [];
  const timers: (() => void)[] = [];
  const bridge = registerViewBridgeIpc({
    ipc,
    canvasId: () => (opts.canvasId === undefined ? CANVAS_ID : opts.canvasId),
    send: (message) => sent.push({ feed: message.feed, data: message.data }),
    callTool,
    activeView: () => 'timeline',
    previewing: () => opts.previewing ?? false,
    trace: (event) => traced.push(event),
    pageContext: () => opts.context ?? null,
    deactivate,
    now: opts.now,
    setInterval: (fn) => {
      timers.push(fn);
      return timers.length as unknown as NodeJS.Timeout;
    },
    clearInterval: () => timers.pop(),
  });
  return {
    bridge,
    sent,
    callTool,
    deactivate,
    traced,
    timers,
    call: (payload: unknown, from = CANVAS_ID) => handlers.get(IPC.viewCall)!({ sender: { id: from } }, payload),
    back: (from = CANVAS_ID) => handlers.get(IPC.viewBack)!({ sender: { id: from } }, {}),
    subscribe: (feed: string, from = CANVAS_ID) => listeners.get(IPC.viewSubscribe)!({ sender: { id: from } }, { feed }),
    unsubscribe: (feed: string, from = CANVAS_ID) => listeners.get(IPC.viewUnsubscribe)!({ sender: { id: from } }, { feed }),
  };
}

describe('refuseToolCall', () => {
  it('allows the reads, the drivers and the four confirmed writes', () => {
    for (const name of VIEW_TOOL_ALLOWLIST) expect(refuseToolCall(name), name).toBeNull();
  });

  it('refuses the drivers and the writes while the view is only a preview', () => {
    for (const name of VIEW_READ_TOOLS) expect(refuseToolCall(name, { previewing: true }), name).toBeNull();
    for (const name of [...VIEW_DRIVER_TOOLS, ...VIEW_ACCOUNT_WRITE_TOOLS])
      expect(refuseToolCall(name, { previewing: true }), name).toBe('This view is a preview; keep it first');
  });

  it('refuses everything else, including the tools that build views', () => {
    for (const name of [
      'x_inspect_page',
      'x_test_selector',
      'x_like_in_page',
      'xpilot_write_page_styles',
      'xpilot_set_selector',
      'xpilot_schedule_task',
      'xpilot_write_view_file',
      'xpilot_activate_view',
      'xpilot_save_article_pdf',
      'xpilot_open_pdf',
      '',
    ])
      expect(refuseToolCall(name), name).toMatch(/may not call/);
  });
});

describe('the view bridge', () => {
  it('runs an allowlisted tool and hands back the plain result', async () => {
    const h = harness();
    expect(await h.call({ tool: 'x_read_visible_posts', args: { limit: 5 } })).toEqual(ok({ called: 'x_read_visible_posts' }));
    expect(h.callTool).toHaveBeenCalledWith('x_read_visible_posts', { limit: 5 }, { origin: { kind: 'view', name: 'timeline' } });
  });

  it('refuses a tool that is not on the list without running it', async () => {
    const h = harness();
    expect(await h.call({ tool: 'xpilot_write_page_styles', args: { css: 'body{}' } })).toMatchObject({
      success: false,
      error: expect.stringContaining('may not call xpilot_write_page_styles'),
    });
    expect(h.callTool).not.toHaveBeenCalled();
  });

  it('answers nobody but the canvas', async () => {
    const h = harness();
    expect(await h.call({ tool: 'x_get_page_state' }, CANVAS_ID + 1)).toEqual({ success: false, error: 'unauthorized' });
    expect(() => h.back(CANVAS_ID + 1)).toThrow(/unauthorized/);
    h.subscribe('page', CANVAS_ID + 1);
    expect(h.sent).toEqual([]);
    expect(h.callTool).not.toHaveBeenCalled();
  });

  it('refuses everything when there is no canvas at all', async () => {
    const h = harness({ canvasId: null });
    expect(await h.call({ tool: 'x_get_page_state' })).toEqual({ success: false, error: 'unauthorized' });
  });

  it('budgets calls, and says what to do instead', async () => {
    let now = 0;
    const h = harness({ now: () => now });
    for (let i = 0; i < VIEW_CALLS_PER_WINDOW; i++) expect(await h.call({ tool: 'x_get_page_state' })).toMatchObject({ success: true });
    expect(await h.call({ tool: 'x_get_page_state' })).toMatchObject({
      success: false,
      error: expect.stringContaining('Subscribe to a feed'),
    });
    now = 10_001;
    expect(await h.call({ tool: 'x_get_page_state' })).toMatchObject({ success: true });
  });

  it('refuses a call that is not a tool name and an object of arguments', async () => {
    const h = harness();
    expect(await h.call({ args: {} })).toMatchObject({ success: false, error: expect.stringContaining('needs a tool name') });
  });

  it('answers a new subscriber with what is known now', () => {
    const posts = [{ id: '1', url: 'https://x.com/a/status/1', authorHandle: 'a', text: 'hi' }];
    const h = harness({ context: context(posts) });
    h.subscribe('page');
    expect(h.sent).toEqual([{ feed: 'page', data: context(posts) }]);
    h.subscribe('posts');
    expect(h.sent[1]).toEqual({ feed: 'posts', data: posts });
  });

  it('pushes a new page context to whichever feeds are listening', () => {
    const h = harness({ context: context() });
    h.bridge.pushPage(context());
    expect(h.sent).toEqual([]);
    h.subscribe('page');
    h.sent.length = 0;
    const posts = [{ id: '2', url: 'https://x.com/b/status/2', authorHandle: 'b', text: 'there' }];
    h.bridge.pushPage(context(posts));
    expect(h.sent).toEqual([{ feed: 'page', data: context(posts) }]);
  });

  it('re-reads the visible posts only while somebody is subscribed to them', async () => {
    const h = harness({ context: context() });
    expect(h.timers).toHaveLength(0);
    h.subscribe('posts');
    expect(h.timers).toHaveLength(1);
    h.callTool.mockClear();
    h.timers[0]();
    await Promise.resolve();
    expect(h.callTool).toHaveBeenCalledWith('x_read_visible_posts', { limit: 50 }, { origin: { kind: 'view', name: 'timeline' } });
    h.unsubscribe('posts');
    expect(h.timers).toHaveLength(0);
  });

  it('drops the subscriptions when the canvas navigates, so the poller stops with the document', () => {
    const h = harness({ context: context() });
    h.subscribe('posts');
    expect(h.timers).toHaveLength(1);
    h.bridge.reset();
    expect(h.timers).toHaveLength(0);
    h.sent.length = 0;
    h.bridge.pushPage(context());
    expect(h.sent).toEqual([]);
  });

  it('back() puts the user on X again', () => {
    const h = harness();
    h.back();
    expect(h.deactivate).toHaveBeenCalled();
  });

  it('traces every call it runs onto the agent stream, under a view: name', async () => {
    const h = harness();
    await h.call({ tool: 'x_get_page_state', args: {} });
    expect(h.traced).toHaveLength(2);
    expect(h.traced[0]).toMatchObject({ type: 'tool.started', name: 'view:x_get_page_state', args: {} });
    expect(h.traced[1]).toMatchObject({ type: 'tool.completed', name: 'view:x_get_page_state', success: true });
    const started = h.traced[0] as { itemId: string };
    const completed = h.traced[1] as { itemId: string; output: string };
    expect(completed.itemId).toBe(started.itemId);
    expect(completed.output).toContain('x_get_page_state');
  });

  it('traces a failing call as a failed row rather than losing it', async () => {
    const h = harness();
    h.callTool.mockRejectedValueOnce(new Error('the page went away'));
    expect(await h.call({ tool: 'x_search', args: { query: 'a' } })).toMatchObject({ success: false, error: 'the page went away' });
    expect(h.traced[1]).toMatchObject({ type: 'tool.completed', success: false, output: 'Error: the page went away' });
  });

  it('names the view every call is made on behalf of', async () => {
    const h = harness();
    await h.call({ tool: 'x_like_post', args: { url: 'https://x.com/a/status/1' } });
    expect(h.callTool).toHaveBeenCalledWith(
      'x_like_post',
      { url: 'https://x.com/a/status/1' },
      { origin: { kind: 'view', name: 'timeline' } },
    );
  });

  it('gives a view that is only previewed the reads, and neither the drivers nor the writes', async () => {
    const h = harness({ previewing: true });
    for (const name of VIEW_READ_TOOLS) expect(await h.call({ tool: name }), name).toMatchObject({ success: true });
    for (const name of [...VIEW_DRIVER_TOOLS, ...VIEW_ACCOUNT_WRITE_TOOLS])
      expect(await h.call({ tool: name }), name).toEqual({ success: false, error: 'This view is a preview; keep it first' });
  });

  it('lets a preview go back to X: that is how the user leaves it', () => {
    const h = harness({ previewing: true });
    h.back();
    expect(h.deactivate).toHaveBeenCalled();
  });
});
