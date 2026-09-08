import { dialog, ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { z } from 'zod';
import { IPC } from '../shared/ipc';
import { PageContextSchema } from '../shared/page';
import { isOpenablePdf } from './library/paths';
import type { AgentEvent } from '../shared/agent';
import type { AgentController } from './agent/controller';
import type { ApprovalBroker } from './approvals';
import type { SettingsStore } from './settings';
import type { HistoryStore } from './history/store';
import type { TaskManager } from './tasks/manager';
import type { DeepPartial, Settings } from '../shared/settings';
import type { BridgeIpc } from './adapter/bridge';

export interface SidebarIpcDeps {
  sidebar: WebContents;
  setSidebarCollapsed(collapsed: boolean): void;
  openLink(url: string): void;
  agent: AgentController;
  approvals: ApprovalBroker;
  settings: SettingsStore;
  history: HistoryStore;
  tasks: TaskManager;
  libraryDir(): string;
  openPath(p: string): Promise<string>;
}

const SendSchema = z.object({ text: z.string().min(1), pageContext: PageContextSchema.nullable() });
const ResolveSchema = z.object({ id: z.string(), decision: z.string() });

export function registerSidebarIpc(deps: SidebarIpcDeps): void {
  const { sidebar, setSidebarCollapsed, openLink, tasks, agent, approvals, settings, history, libraryDir, openPath } = deps;
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
  ipcMain.handle(IPC.linkOpen, guarded((_e, raw) => { openLink(z.object({ url: z.string().max(2048) }).parse(raw).url); }));
  ipcMain.handle(IPC.sidebarSetCollapsed, guarded((_e, raw) => { setSidebarCollapsed(z.object({ collapsed: z.boolean() }).parse(raw).collapsed); }));
  ipcMain.handle(IPC.historyClear, guarded(() => history.clear()));
  ipcMain.handle(IPC.conversationsList, guarded(() => agent.listConversations()));
  ipcMain.handle(IPC.conversationsOpen, guarded((_e, raw) => agent.openConversation(z.object({ threadId: z.string() }).parse(raw).threadId)));
  ipcMain.handle(IPC.tasksList, guarded(() => tasks.list()));
  ipcMain.handle(IPC.tasksUpdate, guarded((_e, raw) => { const { id, enabled } = z.object({ id: z.number().int(), enabled: z.boolean().optional() }).parse(raw); return tasks.update(id, { enabled }); }));
  ipcMain.handle(IPC.tasksDelete, guarded((_e, raw) => { tasks.delete(z.object({ id: z.number().int() }).parse(raw).id); }));
  ipcMain.handle(IPC.tasksRunNow, guarded((_e, raw) => tasks.runNow(z.object({ id: z.number().int() }).parse(raw).id)));
  ipcMain.handle(IPC.libraryList, guarded(() => history.listLibrary()));
  ipcMain.handle(IPC.libraryOpen, guarded(async (_e, raw) => {
    const { path } = z.object({ path: z.string() }).parse(raw);
    if (!isOpenablePdf(path, libraryDir(), (p) => history.hasLibraryPath(p))) throw new Error('not a library PDF');
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
