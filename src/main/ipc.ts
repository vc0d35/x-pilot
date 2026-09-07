import { ipcMain, type WebContents } from 'electron';
import { z } from 'zod';
import { IPC } from '../shared/ipc';
import { PageContextSchema } from '../shared/page';
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
}

const SendSchema = z.object({ text: z.string().min(1), pageContext: PageContextSchema.nullable() });
const ResolveSchema = z.object({ id: z.string(), decision: z.string() });

export function registerSidebarIpc(deps: SidebarIpcDeps): void {
  const { sidebar, agent, approvals, settings, history } = deps;
  const push = (e: AgentEvent) => { if (!sidebar.isDestroyed()) sidebar.send(IPC.agentEvent, e); };
  let lastStatus: AgentEvent | null = null;
  let lastThread: AgentEvent | null = null;
  agent.onEvent((e) => { if (e.type === 'status') lastStatus = e; if (e.type === 'thread') lastThread = e; push(e); });
  approvals.onEvent(push);
  sidebar.on('did-finish-load', () => { if (lastThread) push(lastThread); if (lastStatus) push(lastStatus); });

  ipcMain.handle(IPC.agentSend, async (_e, raw) => { const { text, pageContext } = SendSchema.parse(raw); await agent.send(text, pageContext); });
  ipcMain.handle(IPC.agentInterrupt, () => agent.interrupt());
  ipcMain.handle(IPC.agentNewThread, () => agent.start({ resume: false }));
  ipcMain.handle(IPC.agentReconnect, () => agent.start({ resume: true }));
  ipcMain.handle(IPC.agentResolveApproval, (_e, raw) => { const { id, decision } = ResolveSchema.parse(raw); approvals.resolve(id, decision); });
  ipcMain.handle(IPC.agentListModels, () => agent.listModels());
  ipcMain.handle(IPC.settingsGet, () => settings.get());
  ipcMain.handle(IPC.settingsSet, (_e, patch) => settings.update(patch as DeepPartial<Settings>));
  settings.onChange((s) => { if (!sidebar.isDestroyed()) sidebar.send(IPC.settingsChanged, s); });
  ipcMain.handle(IPC.historyClear, () => history.clear());
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
