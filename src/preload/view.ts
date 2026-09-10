import { contextBridge, ipcRenderer, webFrame } from 'electron';
// Channel names are inlined at build time (see electron.vite.config.ts): this preload is
// sandboxed and must not require() any sibling module.
declare const __XPILOT_IPC__: typeof import('../shared/ipc').IPC;
const IPC = __XPILOT_IPC__;
import {
  VIEW_ERROR_MESSAGE_MAX,
  VIEW_ERROR_REPORTS_PER_WINDOW,
  VIEW_ERROR_REPORT_WINDOW_MS,
  VIEW_ERROR_SOURCE_MAX,
  type ViewErrorReport,
  type ViewFeed,
  type ViewFeedPayload,
  type XPilotViewApi,
} from '../shared/views';
import type { ToolResult } from '../shared/tools';

/**
 * WebRTC is the one network primitive the view's CSP does not govern: `connect-src 'none'` does not
 * cover ICE, so a `RTCPeerConnection` with an attacker's STUN or TURN URL reaches an arbitrary
 * host:port with attacker-chosen bytes in the STUN USERNAME and the hostname. Chromium has no
 * switch and no Blink feature that takes it away (both were measured), so it is removed from the
 * page's own world here: the preload runs before any view script, and the properties are defined
 * non-writable and non-configurable, so nothing the view does puts them back. Workers never had
 * these constructors — they are `[Exposed=Window]` — and the view CSP allows no frames, so the main
 * world is the whole surface.
 */
const WEBRTC_GLOBALS = [
  'RTCPeerConnection',
  'webkitRTCPeerConnection',
  'RTCDataChannel',
  'RTCIceCandidate',
  'RTCSessionDescription',
  'RTCRtpSender',
  'RTCRtpReceiver',
  'RTCDtlsTransport',
  'RTCIceTransport',
  'RTCSctpTransport',
];
const NAVIGATOR_MEDIA = ['mediaDevices', 'getUserMedia', 'webkitGetUserMedia', 'mozGetUserMedia'];

function removeWebRtcSource(): string {
  return `(() => {
  const dead = { value: undefined, writable: false, configurable: false, enumerable: false };
  const strip = (target, names) => {
    if (!target) return;
    for (const name of names) {
      try {
        Object.defineProperty(target, name, dead);
      } catch {
        /* already non-configurable: nothing to take away */
      }
    }
  };
  strip(globalThis, ${JSON.stringify(WEBRTC_GLOBALS)});
  if (typeof window !== 'undefined' && window !== globalThis) strip(window, ${JSON.stringify(WEBRTC_GLOBALS)});
  strip(typeof navigator === 'undefined' ? null : navigator, ${JSON.stringify(NAVIGATOR_MEDIA)});
})()`;
}

// Before anything else, and before any script of the view's own: the API below is worth nothing if
// the page it is handed to can open a socket.
webFrame.executeJavaScript(removeWebRtcSource()).catch((err) => console.error('[xpilot] could not remove WebRTC from a view', err));

/**
 * The whole surface a custom view has. It is exposed into a renderer with no network, no node and
 * no X cookies, so everything a view knows comes through here: two feeds off the page underneath,
 * the allowlisted tools, and the two shortcuts. Nothing here reaches the file system, the settings
 * or the agent.
 */
type Listener = (data: never) => void;
const listeners = new Map<ViewFeed, Set<Listener>>();

ipcRenderer.on(IPC.viewFeed, (_event, message: { feed: ViewFeed; data: unknown }) => {
  for (const cb of [...(listeners.get(message.feed) ?? [])]) {
    try {
      (cb as (data: unknown) => void)(message.data);
    } catch (err) {
      console.error('[xpilot] a view feed listener threw', err);
    }
  }
});

/**
 * A view has no devtools and no console the user can open, so the errors its own scripts throw are
 * relayed to main, where they join the view's log and raise a banner offering to hand the problem to
 * the agent. The listeners live in the isolated world, which still receives the events the page
 * dispatches on `window`; the relay is budgeted and every line is cut, because the one thing a
 * broken view does reliably is throw in a render loop.
 */
const reportedAt: number[] = [];

function relayError(report: ViewErrorReport): void {
  const now = Date.now();
  while (reportedAt.length && now - reportedAt[0] >= VIEW_ERROR_REPORT_WINDOW_MS) reportedAt.shift();
  if (reportedAt.length >= VIEW_ERROR_REPORTS_PER_WINDOW) return;
  reportedAt.push(now);
  ipcRenderer.send(IPC.viewError, {
    kind: report.kind,
    message: report.message.slice(0, VIEW_ERROR_MESSAGE_MAX),
    ...(report.source ? { source: report.source.slice(0, VIEW_ERROR_SOURCE_MAX) } : {}),
    ...(typeof report.line === 'number' ? { line: report.line } : {}),
    ...(typeof report.column === 'number' ? { column: report.column } : {}),
  });
}

/** Whatever the view threw, as one line: an Error keeps its stack's first line, a value is printed. */
function describe(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * The event the page's own world uses to hand an error over. Chromium reports an uncaught error only
 * to the world whose script threw, so a listener here never sees what a view threw; a DOM event does
 * cross the boundary, and its detail travels as a JSON string so no object has to. A view could
 * dispatch one itself: the worst it buys is a line in its own console log, budgeted like the rest.
 */
const VIEW_ERROR_EVENT = 'xpilot:view-error';

/** Installed in the page's own world, before any view script, by webFrame.executeJavaScript. */
function errorRelaySource(): string {
  return `(() => {
  const send = (report) => {
    try {
      window.dispatchEvent(new CustomEvent(${JSON.stringify(VIEW_ERROR_EVENT)}, { detail: JSON.stringify(report) }));
    } catch {
      /* nothing here is worth throwing over */
    }
  };
  const text = (value) => {
    if (value instanceof Error) return value.name + ': ' + value.message;
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      return String(value);
    }
  };
  addEventListener('error', (e) => {
    send({ kind: 'error', message: e.message || text(e.error), source: e.filename || undefined, line: e.lineno || undefined, column: e.colno || undefined });
  });
  addEventListener('unhandledrejection', (e) => {
    send({ kind: 'unhandledrejection', message: 'unhandled rejection: ' + text(e.reason) });
  });
  addEventListener('securitypolicyviolation', (e) => {
    send({
      kind: 'securitypolicyviolation',
      message: 'content policy refused ' + (e.blockedURI || 'something') + ' (' + e.violatedDirective + ')',
      source: e.sourceFile || undefined,
      line: e.lineNumber || undefined,
      column: e.columnNumber || undefined,
    });
  });
})()`;
}

const REPORT_KINDS = ['error', 'unhandledrejection', 'securitypolicyviolation'];

/**
 * The isolated world's half: it relays what the page's world handed over, and its own errors too —
 * an exception out of a feed listener fires here rather than there.
 */
export function installErrorRelay(target: Pick<Window, 'addEventListener'>): void {
  target.addEventListener(VIEW_ERROR_EVENT, (event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (typeof detail !== 'string') return;
    let report: Partial<ViewErrorReport>;
    try {
      report = JSON.parse(detail) as Partial<ViewErrorReport>;
    } catch {
      return;
    }
    if (typeof report.message !== 'string' || !REPORT_KINDS.includes(String(report.kind))) return;
    relayError(report as ViewErrorReport);
  });
  target.addEventListener('error', (e) => {
    relayError({
      kind: 'error',
      message: e.message || describe(e.error),
      source: e.filename || undefined,
      line: e.lineno || undefined,
      column: e.colno || undefined,
    });
  });
  target.addEventListener('unhandledrejection', (e) => {
    relayError({ kind: 'unhandledrejection', message: `unhandled rejection: ${describe(e.reason)}` });
  });
  target.addEventListener('securitypolicyviolation', (e) => {
    relayError({
      kind: 'securitypolicyviolation',
      message: `content policy refused ${e.blockedURI || 'something'} (${e.violatedDirective})`,
      source: e.sourceFile || undefined,
      line: e.lineNumber || undefined,
      column: e.columnNumber || undefined,
    });
  });
}

installErrorRelay(window);
webFrame.executeJavaScript(errorRelaySource()).catch((err) => console.error('[xpilot] could not watch a view for errors', err));

/**
 * Nothing crosses the bridge as a rejection. A view is a page: an exception out of `call()` in a
 * render loop is a blank screen, while a result it can look at is a line it can draw. Main answers
 * with `{ success: false, error }` for every refusal it knows about, and this catches the rest —
 * a dead bridge, a channel that went away with the window.
 */
const bridgeFailed = (err: unknown): ToolResult => ({
  success: false,
  error: err instanceof Error ? err.message : String(err),
});

const api: XPilotViewApi = {
  subscribe<F extends ViewFeed>(feed: F, cb: (data: ViewFeedPayload[F]) => void): () => void {
    const set = listeners.get(feed) ?? new Set<Listener>();
    listeners.set(feed, set);
    set.add(cb);
    // Main answers a subscribe with the current value, so a first frame has something to draw.
    ipcRenderer.send(IPC.viewSubscribe, { feed });
    return () => {
      set.delete(cb);
      if (set.size === 0) ipcRenderer.send(IPC.viewUnsubscribe, { feed });
    };
  },
  call: (tool: string, args?: Record<string, unknown>): Promise<ToolResult> =>
    ipcRenderer.invoke(IPC.viewCall, { tool, args: args ?? {} }).catch(bridgeFailed),
  openInX: (url: string): Promise<ToolResult> =>
    ipcRenderer.invoke(IPC.viewCall, { tool: 'x_navigate', args: { url } }).catch(bridgeFailed),
  back: (): Promise<void> => ipcRenderer.invoke(IPC.viewBack).catch(() => {}),
};

contextBridge.exposeInMainWorld('xpilotView', api);
