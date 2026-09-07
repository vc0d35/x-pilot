import { contextBridge, ipcRenderer, webFrame } from 'electron';
import polyfillSource from './polyfill.js?raw';
import { fail, type ToolModule, type ToolResult } from '../../shared/tools';
import { IPC } from '../../shared/ipc';
import { createPageToolHost } from './page-tools';
import type { PreloadCtx } from './context';
import { adapterTools } from './adapter/tools';
import { installLikeCapture } from './adapter/capture';
import { installFocusTracker } from './adapter/focus';

const host = createPageToolHost();
contextBridge.exposeInMainWorld('__xpilot', host.bridgeApi);
void webFrame.executeJavaScript(polyfillSource);

const ctx: PreloadCtx = { pageTools: host };
const local = new Map<string, ToolModule<PreloadCtx>>(adapterTools.map((t) => [t.spec.name, t]));

function register(): void {
  ipcRenderer.send(IPC.webmcpRegister, { tools: [...local.values()].map((t) => t.spec) });
}
register();

ipcRenderer.on(IPC.webmcpCall, async (_event, msg: { callId: string; name: string; args?: Record<string, unknown> }) => {
  let result: ToolResult;
  const tool = local.get(msg.name);
  if (!tool) result = fail(`Unknown tool in preload: ${msg.name}`);
  else {
    try { result = await tool.execute(msg.args ?? {}, ctx); }
    catch (err) { result = fail(err instanceof Error ? err.message : String(err)); }
  }
  ipcRenderer.send(IPC.webmcpResult, { callId: msg.callId, result });
});

installLikeCapture(document, () => location.href, (channel, payload) => ipcRenderer.send(channel, payload));
installFocusTracker(document, () => location.href, (ctx) => ipcRenderer.send(IPC.focusChanged, ctx));
