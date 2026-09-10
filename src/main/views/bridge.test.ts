import { describe, it, expect, vi } from 'vitest';
import { IPC } from '../../shared/ipc';
import { ok } from '../../shared/tools';
import { VIEW_CALLS_PER_WINDOW, VIEW_TOOL_ALLOWLIST } from '../../shared/views';
import type { PageContext } from '../../shared/page';
import { refuseToolCall, registerViewBridgeIpc, type ViewBridgeIpc } from './bridge';

const CANVAS_ID = 7;

const context = (visible: PageContext['visible'] = []): PageContext => ({
  url: 'https://x.com/home',
  kind: 'home',
  post: null,
  visible,
});

function harness(opts: { canvasId?: number | null; context?: PageContext | null; now?: () => number } = {}) {
  const handlers = new Map<string, (event: { sender: { id: number } }, payload: unknown) => unknown>();
  const listeners = new Map<string, (event: { sender: { id: number } }, payload: unknown) => void>();
  const ipc: ViewBridgeIpc = {
    handle: (channel, listener) => handlers.set(channel, listener),
    on: (channel, listener) => listeners.set(channel, listener),
  };
  const sent: { feed: string; data: unknown }[] = [];
  const callTool = vi.fn(async (name: string) => ok({ called: name }));
  const deactivate = vi.fn();
  const timers: (() => void)[] = [];
  const bridge = registerViewBridgeIpc({
    ipc,
    canvasId: () => (opts.canvasId === undefined ? CANVAS_ID : opts.canvasId),
    send: (message) => sent.push({ feed: message.feed, data: message.data }),
    callTool,
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
    expect(h.callTool).toHaveBeenCalledWith('x_read_visible_posts', { limit: 5 });
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
    expect(h.callTool).toHaveBeenCalledWith('x_read_visible_posts', { limit: 50 });
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
});
