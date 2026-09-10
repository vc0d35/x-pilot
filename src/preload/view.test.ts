// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { IPC } from '../shared/ipc';
import { VIEW_ERROR_MESSAGE_MAX, VIEW_ERROR_REPORTS_PER_WINDOW, VIEW_ERROR_REPORT_WINDOW_MS, type ViewErrorReport } from '../shared/views';
import type { XPilotViewApi } from '../shared/views';

/**
 * The view preload against a fake ipcRenderer, in a document: everything a broken view does — throw
 * on load, reject a promise, be refused by the content policy — has to arrive in main as one capped,
 * budgeted message, and nothing the bridge does may come back to the page as an exception.
 */
const { sent, invoke, exposed } = vi.hoisted(() => ({
  sent: [] as { channel: string; payload: unknown }[],
  invoke: { fail: false },
  exposed: { api: null as XPilotViewApi | null },
}));

vi.mock('electron', () => ({
  ipcRenderer: {
    on: () => {},
    send: (channel: string, payload: unknown) => sent.push({ channel, payload }),
    invoke: async () => {
      if (invoke.fail) throw new Error('no handler for view:call');
      return { success: true, content: {} };
    },
  },
  contextBridge: {
    exposeInMainWorld: (_name: string, api: XPilotViewApi) => {
      exposed.api = api;
    },
  },
  webFrame: { executeJavaScript: async () => {} },
}));

const errors = () => sent.filter((m) => m.channel === IPC.viewError).map((m) => m.payload as ViewErrorReport);

const throwOnLoad = (message: string, source = 'xpilot://views/feed/app.js') =>
  window.dispatchEvent(new ErrorEvent('error', { message, filename: source, lineno: 12, colno: 5 }));

const reject = (reason: unknown) => {
  const event = new Event('unhandledrejection') as Event & { reason?: unknown };
  event.reason = reason;
  window.dispatchEvent(event);
};

const violate = () => {
  const event = new Event('securitypolicyviolation') as Event & Record<string, unknown>;
  Object.assign(event, {
    blockedURI: 'https://evil.example/pixel.png',
    violatedDirective: 'img-src',
    sourceFile: 'xpilot://views/feed/app.js',
    lineNumber: 3,
    columnNumber: 1,
  });
  window.dispatchEvent(event);
};

beforeAll(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-10T10:00:00.000Z'));
  vi.stubGlobal('__XPILOT_IPC__', IPC);
  await import('./view');
});

beforeEach(() => {
  sent.length = 0;
  invoke.fail = false;
  // Past the relay's window, so each test starts with its whole budget.
  vi.setSystemTime(new Date(Date.now() + VIEW_ERROR_REPORT_WINDOW_MS));
});

describe('the view preload error relay', () => {
  it('relays what a view threw, with where it threw it', () => {
    throwOnLoad('TypeError: posts.map is not a function');
    expect(errors()).toEqual([
      {
        kind: 'error',
        message: 'TypeError: posts.map is not a function',
        source: 'xpilot://views/feed/app.js',
        line: 12,
        column: 5,
      },
    ]);
  });

  it('relays an unhandled rejection and a content-policy refusal, which have no line of their own', () => {
    reject(new Error('bridge said no'));
    reject('just a string');
    violate();
    expect(errors()).toEqual([
      { kind: 'unhandledrejection', message: 'unhandled rejection: Error: bridge said no' },
      { kind: 'unhandledrejection', message: 'unhandled rejection: just a string' },
      {
        kind: 'securitypolicyviolation',
        message: 'content policy refused https://evil.example/pixel.png (img-src)',
        source: 'xpilot://views/feed/app.js',
        line: 3,
        column: 1,
      },
    ]);
  });

  it('cuts a message at a kilobyte: a view can throw its whole state', () => {
    throwOnLoad('x'.repeat(VIEW_ERROR_MESSAGE_MAX * 4));
    expect(errors()[0].message).toHaveLength(VIEW_ERROR_MESSAGE_MAX);
  });

  it('sends at most ten in ten seconds, and starts again in the next window', () => {
    for (let i = 0; i < 25; i++) throwOnLoad(`boom ${i}`);
    expect(errors()).toHaveLength(VIEW_ERROR_REPORTS_PER_WINDOW);
    vi.setSystemTime(new Date(Date.now() + VIEW_ERROR_REPORT_WINDOW_MS));
    throwOnLoad('later');
    expect(errors()).toHaveLength(VIEW_ERROR_REPORTS_PER_WINDOW + 1);
  });
});

describe('the view bridge as the page sees it', () => {
  it('answers a dead bridge with a result rather than an exception', async () => {
    invoke.fail = true;
    const api = exposed.api!;
    await expect(api.call('x_get_page_state')).resolves.toEqual({ success: false, error: 'no handler for view:call' });
    await expect(api.openInX('https://x.com/home')).resolves.toEqual({ success: false, error: 'no handler for view:call' });
    await expect(api.back()).resolves.toBeUndefined();
  });

  it('passes a result through untouched when the call worked', async () => {
    await expect(exposed.api!.call('x_get_page_state')).resolves.toEqual({ success: true, content: {} });
  });
});
