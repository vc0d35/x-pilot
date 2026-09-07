import { dialog, ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { z } from 'zod';
import { IPC } from '../shared/ipc';
import { PageContextSchema } from '../shared/page';
import { isInsideDir } from './library/paths';
import type { AgentEvent } from '../shared/agent';
import type { AgentController } from './agent/controller';
import type { ApprovalBroker } from './approvals';
import type { SettingsStore } from './settings';
import type { HistoryStore } from './history/store';
import type { DeepPartial, Settings } from '../shared/settings';
import type { BridgeIpc } from './webmcp/bridge';

export interface SidebarIpcDeps {
  sidebar: WebContents;
  agent: AgentController;
  approvals: ApprovalBroker;
  settings: SettingsStore;
  history: HistoryStore;
  libraryDir(): string;
  openPath(p: string): Promise<string>;
}

const SendSchema = z.object({ text: z.string().min(1), pageContext: PageContextSchema.nullable() });
const ResolveSchema = z.object({ id: z.string(), decision: z.string() });

export function registerSidebarIpc(deps: SidebarIpcDeps): void {
  const { sidebar, agent, approvals, settings, history, libraryDir, openPath } = deps;
  const push = (e: AgentEvent) => { if (!sidebar.isDestroyed()) sidebar.send(IPC.agentEvent, e); };
  let lastStatus: AgentEvent | null = null;
  let lastThread: AgentEvent | null = null;
  agent.onEvent((e) => { if (e.type === 'status') lastStatus = e; if (e.type === 'thread') lastThread = e; push(e); });
  approvals.onEvent(push);
  sidebar.on('did-finish-load', () => { if (lastThread) push(lastThread); if (lastStatus) push(lastStatus); });

  /** Only the sidebar renderer may drive these channels; the X view shares the same ipcMain. */
  const guarded = <A extends unknown[], R>(fn: (event: IpcMainInvokeEvent, ...args: A) => R) => (event: IpcMainInvokeEvent, ...args: A): R => {
    if (event.sender.id !== sidebar.id) throw new Error('unauthorized');
    return fn(event, ...args);
  };

  ipcMain.handle(IPC.agentSend, guarded(async (_e, raw) => { const { text, pageContext } = SendSchema.parse(raw); await agent.send(text, pageContext); }));
  ipcMain.handle(IPC.agentInterrupt, guarded(() => agent.interrupt()));
  ipcMain.handle(IPC.agentNewThread, guarded(() => agent.start({ resume: false })));
  ipcMain.handle(IPC.agentReconnect, guarded(() => agent.start({ resume: true })));
  ipcMain.handle(IPC.agentResolveApproval, guarded((_e, raw) => { const { id, decision } = ResolveSchema.parse(raw); approvals.resolve(id, decision); }));
  ipcMain.handle(IPC.agentListModels, guarded(() => agent.listModels()));
  ipcMain.handle(IPC.settingsGet, guarded(() => settings.get()));
  ipcMain.handle(IPC.settingsSet, guarded((_e, patch) => settings.update(patch as DeepPartial<Settings>)));
  settings.onChange((s) => { if (!sidebar.isDestroyed()) sidebar.send(IPC.settingsChanged, s); });
  ipcMain.handle(IPC.historyClear, guarded(() => history.clear()));
  ipcMain.handle(IPC.libraryList, guarded(() => history.listLibrary()));
  ipcMain.handle(IPC.libraryOpen, guarded(async (_e, raw) => {
    const { path } = z.object({ path: z.string() }).parse(raw);
    if (!isInsideDir(path, libraryDir()) && !history.hasLibraryPath(path)) throw new Error('outside library');
    await openPath(path);
  }));
  ipcMain.handle(IPC.libraryChooseDir, guarded(async () => { const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] }); if (r.canceled || !r.filePaths[0]) return null; settings.update({ library: { dir: r.filePaths[0] } }); return r.filePaths[0]; }));
}

export function registerFocusRelay(deps: { ipc: BridgeIpc; xContentsId: number; sidebar: WebContents }): void {
  let last: unknown = null;
  deps.ipc.on(IPC.focusChanged, (event, payload) => {
    if (event.sender.id !== deps.xContentsId) return;
    const parsed = PageContextSchema.nullable().safeParse(payload);
    if (!parsed.success) return;
    last = parsed.data;
    if (!deps.sidebar.isDestroyed()) deps.sidebar.send(IPC.focusUpdate, parsed.data);
  });
  deps.sidebar.on('did-finish-load', () => deps.sidebar.send(IPC.focusUpdate, last));
}
