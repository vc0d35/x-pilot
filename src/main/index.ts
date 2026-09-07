import { app, ipcMain, shell } from 'electron';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { createMainWindow } from './window';
import { attachNavigationPolicy } from './navigation/policy';
import { SettingsStore } from './settings';
import { ToolRegistry } from './tools/registry';
import { AppToolSource } from './tools/registry';
import { WebMcpBridge } from './webmcp/bridge';
import { XViewController } from './xview';
import { ApprovalBroker } from './approvals';
import { AgentController } from './agent/controller';
import { CodexProvider } from './agent/codex/provider';
import { registerSidebarIpc } from './ipc';
import { xviewTools } from './tools/xview';

const START_URL = process.env.XPILOT_START_URL ?? 'https://x.com/home';
const E2E = process.env.XPILOT_E2E === '1';

app.whenReady().then(async () => {
  const settings = new SettingsStore(join(app.getPath('userData'), 'settings.json'));
  const { xView, sidebar } = createMainWindow({
    preloadX: join(__dirname, '../preload/x.js'),
    preloadSidebar: join(__dirname, '../preload/sidebar.js'),
    rendererUrl: process.env.ELECTRON_RENDERER_URL,
    rendererFile: join(__dirname, '../renderer/index.html'),
  });

  const openExternalCalls: string[] = [];
  const openExternal = (url: string) => { openExternalCalls.push(url); if (!E2E) void shell.openExternal(url); };
  attachNavigationPolicy(xView.webContents, { allowHosts: () => settings.get().navigation.allowHosts, openExternal });
  xView.webContents.on('did-create-window', (child) => {
    attachNavigationPolicy(child.webContents, { allowHosts: () => [...settings.get().navigation.allowHosts, 'accounts.google.com', 'appleid.apple.com'], openExternal });
  });

  const registry = new ToolRegistry();
  const bridge = new WebMcpBridge(ipcMain, xView.webContents);
  registry.addSource(bridge);
  const xview = new XViewController(xView.webContents, bridge);
  registry.addSource(new AppToolSource('xview', xviewTools, { xview, allowHosts: () => settings.get().navigation.allowHosts }));
  registry.onChange(() => console.log('[xpilot] tools:', registry.list().map((t) => t.name).join(', ')));

  const approvals = new ApprovalBroker();
  const workspaceDir = join(app.getPath('userData'), 'workspace');
  mkdirSync(workspaceDir, { recursive: true });
  const agent = new AgentController({
    registry, settings, workspaceDir,
    createProvider: () => new CodexProvider({ callTool: (n, a) => registry.call(n, a), approvals }),
  });
  registerSidebarIpc({ sidebar: sidebar.webContents, agent, approvals, settings });

  if (E2E) (globalThis as Record<string, unknown>).__xpilotTest = { registry, xview, bridge, openExternalCalls, settings, xView, sidebar, agent };

  await xView.webContents.loadURL(START_URL);
  if (!E2E) {
    await bridge.waitForReady(20_000).catch(() => console.warn('[xpilot] X view tools not ready; starting agent without them'));
    await agent.start({ resume: true });
  }
});

app.on('window-all-closed', () => app.quit());
