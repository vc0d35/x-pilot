import { describe, it, expect, vi } from 'vitest';
import { IPC } from '../../shared/ipc';
import { ok } from '../../shared/tools';
import {
  VIEW_CALLS_PER_WINDOW,
  VIEW_DRIVER_TOOLS,
  VIEW_ERROR_MESSAGE_MAX,
  VIEW_ERROR_REPORTS_PER_WINDOW,
  VIEW_ERROR_REPORT_WINDOW_MS,
  VIEW_ERROR_SOURCE_MAX,
  VIEW_ACCOUNT_WRITE_TOOLS,
  VIEW_READ_TOOLS,
  VIEW_STATE_BYTES_MAX,
  VIEW_STATE_ITEMS_MAX,
  VIEW_STATE_SUMMARY_MAX,
  VIEW_STATE_UPDATES_PER_WINDOW,
  VIEW_STATE_WINDOW_MS,
  VIEW_TOOL_ALLOWLIST,
  type ViewState,
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
  const reportError = vi.fn();
  const published: ViewState[] = [];
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
    reportError,
    publishState: (state) => published.push(state),
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
    reportError,
    published,
    traced,
    timers,
    call: (payload: unknown, from = CANVAS_ID) => handlers.get(IPC.viewCall)!({ sender: { id: from } }, payload),
    back: (from = CANVAS_ID) => handlers.get(IPC.viewBack)!({ sender: { id: from } }, {}),
    subscribe: (feed: string, from = CANVAS_ID) => listeners.get(IPC.viewSubscribe)!({ sender: { id: from } }, { feed }),
    unsubscribe: (feed: string, from = CANVAS_ID) => listeners.get(IPC.viewUnsubscribe)!({ sender: { id: from } }, { feed }),
    reportedError: (payload: unknown, from = CANVAS_ID) => listeners.get(IPC.viewError)!({ sender: { id: from } }, payload),
    setState: (state: unknown, from = CANVAS_ID) => handlers.get(IPC.viewSetState)!({ sender: { id: from } }, { state }),
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

describe('the errors a view relays about itself', () => {
  it('passes on what the view threw, capped, and only from the canvas', () => {
    const h = harness();
    h.reportedError({ kind: 'error', message: 'TypeError: x', source: 'app.js', line: 4, column: 2 });
    expect(h.reportError).toHaveBeenCalledWith({ kind: 'error', message: 'TypeError: x', source: 'app.js', line: 4, column: 2 });
    // Another renderer on the same ipcMain — the sidebar, an X view — is not the canvas.
    h.reportedError({ kind: 'error', message: 'from elsewhere' }, CANVAS_ID + 1);
    expect(h.reportError).toHaveBeenCalledTimes(1);
    h.reportedError({ kind: 'unknown', message: 'nonsense' });
    h.reportedError('not an object');
    expect(h.reportError).toHaveBeenCalledTimes(1);
  });

  it('cuts a message the view padded out, whatever the preload sent', () => {
    const h = harness();
    h.reportedError({ kind: 'error', message: 'x'.repeat(VIEW_ERROR_MESSAGE_MAX * 2), source: 'y'.repeat(VIEW_ERROR_SOURCE_MAX * 2) });
    const report = h.reportError.mock.calls[0][0] as { message: string; source: string };
    expect(report.message).toHaveLength(VIEW_ERROR_MESSAGE_MAX);
    expect(report.source).toHaveLength(VIEW_ERROR_SOURCE_MAX);
  });

  it('takes ten reports in ten seconds and drops the rest: a broken view throws in a loop', () => {
    let at = 0;
    const h = harness({ now: () => at });
    for (let i = 0; i < 25; i++) h.reportedError({ kind: 'error', message: `boom ${i}` });
    expect(h.reportError).toHaveBeenCalledTimes(VIEW_ERROR_REPORTS_PER_WINDOW);
    at += VIEW_ERROR_REPORT_WINDOW_MS;
    h.reportedError({ kind: 'error', message: 'later' });
    expect(h.reportError).toHaveBeenCalledTimes(VIEW_ERROR_REPORTS_PER_WINDOW + 1);
  });
});

describe('the state a view publishes about itself', () => {
  it('keeps what the view says it is showing, and says how big it was', async () => {
    const h = harness();
    const state = {
      summary: '42 posts, j/k moves the highlight',
      focus: { url: 'https://x.com/a/status/1', authorHandle: 'a', text: 'hello' },
      items: [{ url: 'https://x.com/a/status/1', authorHandle: 'a', text: 'hello' }],
      extra: { filter: 'from:a', unread: 3, live: true },
    };
    expect(await h.setState(state)).toMatchObject({ success: true, content: { status: 'published' } });
    expect(h.published).toEqual([state]);
  });

  it('answers nobody but the canvas', async () => {
    const h = harness();
    expect(await h.setState({ summary: 'from elsewhere' }, CANVAS_ID + 1)).toEqual({ success: false, error: 'unauthorized' });
    expect(h.published).toEqual([]);
  });

  it('refuses a shape that is not a view state, naming the field', async () => {
    const h = harness();
    expect(await h.setState({ focus: 'the first post' })).toMatchObject({
      success: false,
      error: expect.stringContaining('focus'),
    });
    // A key the contract does not have is refused rather than dropped: a typo is a focus that
    // silently never arrives.
    expect(await h.setState({ summary: 'ok', focussed: { url: 'https://x.com/a/status/1' } })).toMatchObject({
      success: false,
      error: expect.stringContaining('focussed'),
    });
    expect(await h.setState('not an object')).toMatchObject({ success: false });
    expect(h.published).toEqual([]);
  });

  it('cuts what is merely too long, and keeps the first items', async () => {
    const h = harness();
    expect(
      await h.setState({
        summary: 's'.repeat(VIEW_STATE_SUMMARY_MAX + 40),
        items: Array.from({ length: VIEW_STATE_ITEMS_MAX + 5 }, (_, i) => ({ text: `post ${i}` })),
      }),
    ).toMatchObject({ success: true });
    const state = h.published[0];
    expect(state.summary).toHaveLength(VIEW_STATE_SUMMARY_MAX);
    expect(state.items).toHaveLength(VIEW_STATE_ITEMS_MAX);
    expect(state.items![0]).toEqual({ text: 'post 0' });
  });

  it('refuses a state that is padded out past the whole cap', async () => {
    const h = harness();
    const filler = { authorHandle: 'a', text: 'x'.repeat(200), url: `https://x.com/a/status/${'1'.repeat(400)}` };
    const r = await h.setState({ items: Array.from({ length: VIEW_STATE_ITEMS_MAX }, () => filler) });
    expect(r).toMatchObject({ success: false, error: expect.stringContaining(`${VIEW_STATE_BYTES_MAX / 1024} KB`) });
    expect(h.published).toEqual([]);
  });

  it('takes four a second and refuses the rest, then starts again in the next window', async () => {
    let now = 0;
    const h = harness({ now: () => now });
    for (let i = 0; i < VIEW_STATE_UPDATES_PER_WINDOW; i++)
      expect(await h.setState({ summary: `state ${i}` })).toMatchObject({ success: true });
    expect(await h.setState({ summary: 'one too many' })).toMatchObject({
      success: false,
      error: expect.stringContaining('not on every frame'),
    });
    expect(h.published).toHaveLength(VIEW_STATE_UPDATES_PER_WINDOW);
    now += VIEW_STATE_WINDOW_MS;
    expect(await h.setState({ summary: 'later' })).toMatchObject({ success: true });
    expect(h.published.at(-1)).toEqual({ summary: 'later' });
  });
});

describe('the messages the agent sends a view', () => {
  it('pushes one onto the message feed', () => {
    const h = harness();
    h.subscribe('message');
    // Unlike page and posts, a new subscriber is answered with nothing: nothing has been said yet.
    expect(h.sent).toEqual([]);
    h.bridge.pushMessage({ type: 'focus', url: 'https://x.com/a/status/1' });
    expect(h.sent).toEqual([{ feed: 'message', data: { type: 'focus', url: 'https://x.com/a/status/1' } }]);
  });
});
