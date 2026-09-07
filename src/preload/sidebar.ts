import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc';
import type { XPilotApi } from '../shared/sidebar-api';

const subscribe = <T,>(channel: string) => (cb: (v: T) => void) => {
  const listener = (_e: unknown, v: T) => cb(v);
  ipcRenderer.on(channel, listener);
  return () => { ipcRenderer.removeListener(channel, listener); };
};

const api: XPilotApi = {
  send: (text, pageContext) => ipcRenderer.invoke(IPC.agentSend, { text, pageContext }),
  interrupt: () => ipcRenderer.invoke(IPC.agentInterrupt),
  newThread: () => ipcRenderer.invoke(IPC.agentNewThread),
  reconnect: () => ipcRenderer.invoke(IPC.agentReconnect),
  resolveApproval: (id, decision) => ipcRenderer.invoke(IPC.agentResolveApproval, { id, decision }),
  listModels: () => ipcRenderer.invoke(IPC.agentListModels),
  getSettings: () => ipcRenderer.invoke(IPC.settingsGet),
  setSettings: (patch) => ipcRenderer.invoke(IPC.settingsSet, patch),
  listLibrary: () => ipcRenderer.invoke(IPC.libraryList),
  openPdf: (path) => ipcRenderer.invoke(IPC.libraryOpen, { path }),
  chooseLibraryDir: () => ipcRenderer.invoke(IPC.libraryChooseDir),
  clearHistory: () => ipcRenderer.invoke(IPC.historyClear),
  onEvent: subscribe(IPC.agentEvent),
  onFocus: subscribe(IPC.focusUpdate),
  onSettings: subscribe(IPC.settingsChanged),
};

contextBridge.exposeInMainWorld('xpilot', api);
