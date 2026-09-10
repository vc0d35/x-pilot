import { contextBridge, ipcRenderer } from 'electron';
// Channel names are inlined at build time (see electron.vite.config.ts): this preload is
// sandboxed and must not require() any sibling module.
declare const __XPILOT_IPC__: typeof import('../shared/ipc').IPC;
const IPC = __XPILOT_IPC__;
import type { ViewFeed, ViewFeedPayload, XPilotViewApi } from '../shared/views';
import type { ToolResult } from '../shared/tools';

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
