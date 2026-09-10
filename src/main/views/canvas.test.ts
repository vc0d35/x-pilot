import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  VIEW_LOG_LIMIT,
  VIEW_LOG_TEXT_MAX,
  VIEW_RUNTIME_ERRORS_PER_WINDOW,
  VIEW_STORM_MESSAGE,
  VIEW_UNRESPONSIVE_MS,
} from '../../shared/views';
import { ViewCanvas, ViewLogs, attachCanvasNavigationPolicy, type NavigationLike, type ViewFailure } from './canvas';

/**
 * A WebContentsView with no Chromium under it: the canvas's failure handling is which event means
 * what and what the user is told, and none of that needs a renderer. The last contents the canvas
 * built is left on globalThis, so a test can raise the events Electron would.
 */
type FakeCanvasContents = EventEmitter & { reloads: number; loaded: string[]; destroyed: boolean };
const builtContents = (): FakeCanvasContents => (globalThis as { __canvasContents?: FakeCanvasContents }).__canvasContents!;

vi.mock('electron', async () => {
  const { EventEmitter: Emitter } = await import('node:events');
  class FakeContents extends Emitter {
    reloads = 0;
    loaded: string[] = [];
    destroyed = false;
    isDestroyed(): boolean {
      return this.destroyed;
    }
    async loadURL(url: string): Promise<void> {
      this.loaded.push(url);
    }
    reloadIgnoringCache(): void {
      this.reloads += 1;
    }
    close(): void {
      this.destroyed = true;
    }
    setWindowOpenHandler(): void {}
  }
  return {
    WebContentsView: class {
      readonly webContents = new FakeContents();
      constructor() {
        (globalThis as { __canvasContents?: unknown }).__canvasContents = this.webContents;
      }
      setBounds(): void {}
    },
  };
});

function fakeContents() {
  const em = new EventEmitter();
  let handler: (() => { action: string }) | null = null;
  return {
    on: (event: string, listener: (details: NavigationLike) => void) => em.on(event, listener),
    setWindowOpenHandler: (h: () => { action: 'deny' }) => {
      handler = h;
    },
    open: () => handler!(),
    navigate: (url: string, event = 'will-navigate', isMainFrame = true) => {
      const details = {
        url,
        isMainFrame,
        prevented: false,
        preventDefault() {
          this.prevented = true;
        },
      };
      em.emit(event, details);
      return details.prevented;
    },
  };
}

describe('attachCanvasNavigationPolicy', () => {
  it('keeps a canvas inside the view it is showing', () => {
    const c = fakeContents();
    let active: string | null = 'xpilot://views/feed/';
    attachCanvasNavigationPolicy(c, () => active);
    expect(c.navigate('xpilot://views/feed/page-two.html')).toBe(false);
    for (const url of ['xpilot://views/other/index.html', 'https://x.com/home', 'file:///etc/passwd', 'about:blank'])
      expect(c.navigate(url), url).toBe(true);
    expect(c.navigate('xpilot://views/feed/frame.html', 'will-redirect')).toBe(false);
    expect(c.navigate('https://evil.example/', 'will-frame-navigate', false)).toBe(true);
    // With no view showing there is nothing to be inside of, so nothing is allowed.
    active = null;
    expect(c.navigate('xpilot://views/feed/page-two.html')).toBe(true);
  });

  it('opens no windows', () => {
    const c = fakeContents();
    attachCanvasNavigationPolicy(c, () => 'xpilot://views/feed/');
    expect(c.open()).toEqual({ action: 'deny' });
  });
});

describe('ViewLogs', () => {
  it('keeps the newest entries per view and caps how long a line can be', () => {
    const logs = new ViewLogs();
    for (let i = 0; i < VIEW_LOG_LIMIT + 10; i++) logs.add('feed', { source: 'console', level: 'info', text: `line ${i}` });
    logs.add('other', { source: 'console', level: 'error', text: 'x'.repeat(VIEW_LOG_TEXT_MAX + 100) });
    const feed = logs.get('feed', 500);
    expect(feed).toHaveLength(VIEW_LOG_LIMIT);
    expect(feed[0].text).toBe('line 10');
    expect(feed.at(-1)).toMatchObject({ text: `line ${VIEW_LOG_LIMIT + 9}`, source: 'console', level: 'info' });
    expect(logs.get('other', 10)[0].text).toHaveLength(VIEW_LOG_TEXT_MAX + 1);
  });

  it('returns the newest few, of one view or of all of them', () => {
    const logs = new ViewLogs();
    logs.add('a', { source: 'console', level: 'info', text: 'one', at: '2026-01-01T00:00:00.000Z' });
    logs.add('b', { source: 'crash', level: 'error', text: 'two', at: '2026-01-01T00:00:01.000Z' });
    logs.add('a', { source: 'console', level: 'info', text: 'three', at: '2026-01-01T00:00:02.000Z' });
    expect(logs.get('a', 1).map((e) => e.text)).toEqual(['three']);
    expect(logs.get(undefined, 10).map((e) => e.text)).toEqual(['one', 'two', 'three']);
    expect(logs.views()).toEqual(['a', 'b']);
    logs.clear('a');
    expect(logs.get('a', 10)).toEqual([]);
  });
});

/**
 * The canvas's own failure handling, against a fake WebContentsView: what comes off the screen, what
 * is only said, and what a storm of either does. Electron is mocked because the class is the policy —
 * which event means what, and what the user is told — and none of that needs a renderer.
 */
describe('ViewCanvas failure handling', () => {
  const canvasFor = async (name = 'feed') => {
    const failures: ViewFailure[] = [];
    const active: (string | null)[] = [];
    let at = 1_000_000;
    const canvas = new ViewCanvas(
      {
        preload: '/preload/view.js',
        partition: 'views',
        mount: () => {},
        unmount: () => {},
        bounds: () => ({ x: 0, y: 0, width: 100, height: 100 }),
        onError: (failure) => failures.push(failure),
        onActive: (view) => active.push(view),
      },
      () => at,
    );
    expect(await canvas.show(name)).toBeNull();
    const contents = builtContents();
    return { canvas, failures, active, contents, advance: (ms: number) => (at += ms) };
  };

  it('takes a view off the screen when its renderer dies, and says which of the phases it was', async () => {
    const c = await canvasFor();
    c.contents.emit('render-process-gone', {}, { reason: 'crashed' });
    expect(c.canvas.active()).toBeNull();
    expect(c.active).toEqual(['feed', null]);
    expect(c.failures).toEqual([{ view: 'feed', phase: 'crash', message: "the view's renderer stopped (crashed)", fatal: true }]);
    expect(c.canvas.logs.get('feed', 5).at(-1)!.text).toContain('crash:');
  });

  it('reports a load that failed once, however many events the one failure raises', async () => {
    const c = await canvasFor();
    c.contents.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'xpilot://views/feed/index.html', true);
    c.contents.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'xpilot://views/feed/index.html', true);
    expect(c.failures).toEqual([{ view: 'feed', phase: 'load', message: 'ERR_NAME_NOT_RESOLVED', fatal: true }]);
  });

  it('ignores a cancelled load and a subframe: neither is the view failing', async () => {
    const c = await canvasFor();
    c.contents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'xpilot://views/feed/index.html', true);
    c.contents.emit('did-fail-load', {}, -105, 'ERR_FAILED', 'xpilot://views/feed/frame.html', false);
    expect(c.failures).toEqual([]);
    expect(c.canvas.active()).toBe('feed');
  });

  it('gives a wedged renderer ten seconds, and lets it off when it comes back', async () => {
    vi.useFakeTimers();
    try {
      const c = await canvasFor();
      c.contents.emit('unresponsive');
      vi.advanceTimersByTime(VIEW_UNRESPONSIVE_MS - 1);
      expect(c.failures).toEqual([]);
      c.contents.emit('responsive');
      vi.advanceTimersByTime(VIEW_UNRESPONSIVE_MS);
      expect(c.failures).toEqual([]);
      expect(c.canvas.active()).toBe('feed');
      // And a wedge it never comes back from takes the screen back.
      c.contents.emit('unresponsive');
      vi.advanceTimersByTime(VIEW_UNRESPONSIVE_MS);
      expect(c.failures).toEqual([{ view: 'feed', phase: 'unresponsive', message: expect.stringContaining('10 s'), fatal: true }]);
      expect(c.canvas.active()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('ends a view that crashes twice inside five minutes rather than being retried into', async () => {
    const c = await canvasFor();
    c.contents.emit('render-process-gone', {}, { reason: 'crashed' });
    await c.canvas.show('feed');
    c.contents.emit('render-process-gone', {}, { reason: 'crashed' });
    expect(c.failures.at(-1)).toEqual({ view: 'feed', phase: 'runtime', message: VIEW_STORM_MESSAGE, fatal: true });
  });

  it('keeps a view that only threw on screen, and says so once', async () => {
    const c = await canvasFor();
    c.canvas.noteRuntimeError({ kind: 'error', message: 'TypeError: x is not a function', source: 'app.js', line: 4, column: 2 });
    c.canvas.noteRuntimeError({ kind: 'error', message: 'TypeError: again' });
    expect(c.canvas.active()).toBe('feed');
    expect(c.failures).toEqual([{ view: 'feed', phase: 'runtime', message: 'TypeError: x is not a function', fatal: false }]);
    const logged = c.canvas.logs.get('feed', 10);
    expect(logged.at(-2)).toMatchObject({ source: 'error', text: 'TypeError: x is not a function', where: 'app.js:4:2' });
    expect(logged.at(-1)).toMatchObject({ source: 'error', text: 'TypeError: again' });
    expect(logged.at(-1)!.where).toBeUndefined();
  });

  it('deactivates a view that is erroring in a loop', async () => {
    const c = await canvasFor();
    for (let i = 0; i <= VIEW_RUNTIME_ERRORS_PER_WINDOW; i++) c.canvas.noteRuntimeError({ kind: 'error', message: `boom ${i}` });
    expect(c.canvas.active()).toBeNull();
    expect(c.failures.at(-1)).toEqual({ view: 'feed', phase: 'runtime', message: VIEW_STORM_MESSAGE, fatal: true });
  });

  it('ignores an error relayed after the view went away', async () => {
    const c = await canvasFor();
    c.canvas.hide();
    c.canvas.noteRuntimeError({ kind: 'error', message: 'late' });
    expect(c.failures).toEqual([]);
  });

  it('says a view that could never be shown failed, without touching the screen', async () => {
    const c = await canvasFor();
    c.canvas.reportFailure('other', 'load', 'there is no index.html to load');
    expect(c.canvas.active()).toBe('feed');
    expect(c.failures).toEqual([{ view: 'other', phase: 'load', message: 'there is no index.html to load', fatal: true }]);
  });

  it('reloads the view that changed, once, and nothing once it is off the screen', async () => {
    vi.useFakeTimers();
    try {
      const c = await canvasFor();
      c.canvas.scheduleReload('feed');
      c.canvas.scheduleReload('feed');
      vi.advanceTimersByTime(500);
      expect(c.contents.reloads).toBe(1);
      c.canvas.scheduleReload('other');
      c.canvas.hide();
      c.canvas.scheduleReload('feed');
      vi.advanceTimersByTime(500);
      expect(c.contents.reloads).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
