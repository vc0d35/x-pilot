import { ipcRenderer } from 'electron';
import { fail, type ToolModule, type ToolResult } from '../../shared/tools';
import { IPC } from '../../shared/ipc';
import type { PreloadCtx } from './context';
import { adapterTools, runAdapterTool } from './adapter/tools';
import { installLikeCapture } from './adapter/capture';
import { installFocusTracker } from './adapter/focus';

const ctx: PreloadCtx = {};
const local = new Map<string, ToolModule<PreloadCtx>>(adapterTools.map((t) => [t.spec.name, t]));

function register(): void {
  ipcRenderer.send(IPC.adapterRegister, { tools: [...local.values()].map((t) => t.spec) });
}
register();

ipcRenderer.on(IPC.adapterCall, async (_event, msg: { callId: string; name: string; args?: Record<string, unknown> }) => {
  const result: ToolResult = local.has(msg.name) ? await runAdapterTool(msg.name, msg.args ?? {}, ctx) : fail(`Unknown tool in preload: ${msg.name}`);
  ipcRenderer.send(IPC.adapterResult, { callId: msg.callId, result });
});

installLikeCapture(document, () => location.href, (channel, payload) => ipcRenderer.send(channel, payload));
installFocusTracker(document, () => location.href, (ctx) => ipcRenderer.send(IPC.focusChanged, ctx));
