import { contextBridge, ipcRenderer } from 'electron';
// Channel names are inlined at build time (see electron.vite.config.ts): this preload is
// sandboxed and must not require() any sibling module.
declare const __XPILOT_IPC__: typeof import('../shared/ipc').IPC;
const IPC = __XPILOT_IPC__;
import type { XPilotApi } from '../shared/sidebar-api';

const subscribe =
  <T>(channel: string) =>
  (cb: (v: T) => void) => {
    const listener = (_e: unknown, v: T) => cb(v);
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  };

const api: XPilotApi = {
  send: (text, pageContext) => ipcRenderer.invoke(IPC.agentSend, { text, pageContext }),
  interrupt: () => ipcRenderer.invoke(IPC.agentInterrupt),
  newThread: () => ipcRenderer.invoke(IPC.agentNewThread),
  reconnect: () => ipcRenderer.invoke(IPC.agentReconnect),
  resolveApproval: (id, decision, note) => ipcRenderer.invoke(IPC.agentResolveApproval, { id, decision, note }),
  resolveInput: (id, answers) => ipcRenderer.invoke(IPC.agentResolveInput, { id, answers }),
  listModels: () => ipcRenderer.invoke(IPC.agentListModels),
  getSettings: () => ipcRenderer.invoke(IPC.settingsGet),
  setSettings: (patch) => ipcRenderer.invoke(IPC.settingsSet, patch),
  listLibrary: () => ipcRenderer.invoke(IPC.libraryList),
  listConversations: () => ipcRenderer.invoke(IPC.conversationsList),
  listTasks: () => ipcRenderer.invoke(IPC.tasksList),
  updateTask: (id, patch) => ipcRenderer.invoke(IPC.tasksUpdate, { id, ...patch }),
  deleteTask: (id) => ipcRenderer.invoke(IPC.tasksDelete, { id }),
  runTaskNow: (id) => ipcRenderer.invoke(IPC.tasksRunNow, { id }),
  openConversation: (threadId) => ipcRenderer.invoke(IPC.conversationsOpen, { threadId }),
  openPdf: (path) => ipcRenderer.invoke(IPC.libraryOpen, { path }),
  chooseLibraryDir: () => ipcRenderer.invoke(IPC.libraryChooseDir),
  pageConfigStatus: () => ipcRenderer.invoke(IPC.pageConfigStatus),
  openPageConfig: (kind) => ipcRenderer.invoke(IPC.pageConfigOpen, { kind }),
  resetPageConfig: (kind) => ipcRenderer.invoke(IPC.pageConfigReset, { kind }),
  setCodexBinary: (action) => ipcRenderer.invoke(IPC.settingsCodexBinary, { action }),
  clearHistory: () => ipcRenderer.invoke(IPC.historyClear),
  historyStats: () => ipcRenderer.invoke(IPC.historyStats),
  setSidebarCollapsed: (collapsed) => ipcRenderer.invoke(IPC.sidebarSetCollapsed, { collapsed }),
  openLink: (url) => ipcRenderer.invoke(IPC.linkOpen, { url }),
  onEvent: subscribe(IPC.agentEvent),
  onConversationEvent: subscribe(IPC.conversationEvent),
  onFocus: subscribe(IPC.focusUpdate),
  onSettings: subscribe(IPC.settingsChanged),
  onSidebarCollapsed: subscribe(IPC.sidebarCollapsed),
  onFocusInput: subscribe(IPC.sidebarFocusInput),
};

contextBridge.exposeInMainWorld('xpilot', api);
