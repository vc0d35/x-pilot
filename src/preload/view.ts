import { contextBridge, ipcRenderer, webFrame } from 'electron';
// Channel names are inlined at build time (see electron.vite.config.ts): this preload is
// sandboxed and must not require() any sibling module.
declare const __XPILOT_IPC__: typeof import('../shared/ipc').IPC;
const IPC = __XPILOT_IPC__;
import type { ViewFeed, ViewFeedPayload, XPilotViewApi } from '../shared/views';
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
  call: (tool: string, args?: Record<string, unknown>): Promise<ToolResult> => ipcRenderer.invoke(IPC.viewCall, { tool, args: args ?? {} }),
  openInX: (url: string): Promise<ToolResult> => ipcRenderer.invoke(IPC.viewCall, { tool: 'x_navigate', args: { url } }),
  back: (): Promise<void> => ipcRenderer.invoke(IPC.viewBack),
};

contextBridge.exposeInMainWorld('xpilotView', api);
