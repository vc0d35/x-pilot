import { app, net, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { createMainWindow } from './window';
import { installAppMenu } from './menu';
import { configureTouchIdPasskeys, resolveKeychainGroup } from './webauthn';
import { resolveShortLink, routeShortLink } from './navigation/shortlink';
import { attachNavigationPolicy, POPUP_ONLY_HOSTS } from './navigation/policy';
import { SettingsStore } from './settings';
import { ToolRegistry } from './tools/registry';
import { AppToolSource } from './tools/registry';
import { WebMcpBridge } from './webmcp/bridge';
import { XViewController } from './xview';
import { BackgroundXView } from './background-view';
import { ApprovalBroker } from './approvals';
import { AgentController } from './agent/controller';
import { CodexProvider } from './agent/codex/provider';
import { registerSidebarIpc, registerFocusRelay } from './ipc';
import { xviewTools } from './tools/xview';
import { DraftStore } from './tools/xview/drafts';
import { HistoryStore } from './history/store';
import { registerHistoryIpc } from './history/ipc';
import { appTools } from './tools/app';
import { exportPdf } from './library/pdf';

const START_URL = process.env.XPILOT_START_URL ?? 'https://x.com/home';
const E2E = process.env.XPILOT_E2E === '1';

if (process.env.XPILOT_USER_DATA) app.setPath('userData', process.env.XPILOT_USER_DATA);

app.whenReady().then(async () => {
  const settings = new SettingsStore(join(app.getPath('userData'), 'settings.json'));
  const { xView, sidebar, setSidebarCollapsed, isSidebarCollapsed } = createMainWindow({
    preloadX: join(__dirname, '../preload/x.js'),
    preloadSidebar: join(__dirname, '../preload/sidebar.js'),
    rendererUrl: process.env.ELECTRON_RENDERER_URL,
    rendererFile: join(__dirname, '../renderer/index.html'),
  });
  configureTouchIdPasskeys({ app, onSelectAccount: (l) => { xView.webContents.session.on('select-webauthn-account', l); }, group: resolveKeychainGroup(process.env, process.platform) });

  const openExternalCalls: string[] = [];
  const openExternal = (url: string) => { openExternalCalls.push(url); if (!E2E) void shell.openExternal(url); };
  const headFetch = async (url: string) => {
    const res = await net.fetch(url, { method: 'HEAD', redirect: 'manual' });
    return { status: res.status, location: res.headers.get('location') };
  };
  const openShortLink = (url: string) => {
    void resolveShortLink(url, headFetch).then((target) => {
      const route = routeShortLink(target, settings.get().navigation.allowHosts);
      if (route === 'view') void xView.webContents.loadURL(target);
      else if (route === 'external') openExternal(target);
    });
  };
  attachNavigationPolicy(xView.webContents, { allowHosts: () => settings.get().navigation.allowHosts, openExternal, openShortLink });
  xView.webContents.on('did-create-window', (child) => {
    attachNavigationPolicy(child.webContents, { allowHosts: () => [...settings.get().navigation.allowHosts, ...POPUP_ONLY_HOSTS], openExternal });
  });

  const approvals = new ApprovalBroker();
  const registry = new ToolRegistry();
  const bridge = new WebMcpBridge(ipcMain, xView.webContents);
  registry.addSource(bridge);
  const xview = new XViewController(xView.webContents, bridge);
  const background = new BackgroundXView({ preload: join(__dirname, '../preload/x.js'), allowHosts: () => settings.get().navigation.allowHosts, openExternal });
  app.on('will-quit', () => background.destroy());
  registry.addSource(new AppToolSource('xview', xviewTools, {
    xview, background: () => background.get(), allowHosts: () => settings.get().navigation.allowHosts,
    approvals, postingMode: () => settings.get().posting.mode, drafts: new DraftStore(),
  }));
  registry.onChange(() => console.log('[xpilot] tools:', registry.list().map((t) => t.name).join(', ')));

  const history = new HistoryStore(join(app.getPath('userData'), 'history.sqlite'));
  registerHistoryIpc({ ipc: ipcMain, xContentsId: xView.webContents.id, store: history });
  const libraryDir = () => settings.get().library.dir ?? join(app.getPath('documents'), 'X Pilot');
  const appCtx = {
    history, libraryDir,
    exportPdf: (url: string, outDir: string) => exportPdf({ url, outDir }, {
      createWindow: () => {
        const w = new BrowserWindow({ show: false, width: 900, height: 1400, webPreferences: { partition: 'persist:x', sandbox: true, contextIsolation: true } });
        return { loadURL: (u) => w.loadURL(u), executeJavaScript: (c) => w.webContents.executeJavaScript(c, true), printToPDF: (o) => w.webContents.printToPDF(o), destroy: () => w.destroy() };
      },
    }),
    openPath: (p: string) => shell.openPath(p),
  };
  registry.addSource(new AppToolSource('app', appTools, appCtx));
  app.on('will-quit', () => history.close());

  const workspaceDir = join(app.getPath('userData'), 'workspace');
  mkdirSync(workspaceDir, { recursive: true });
  const agent = new AgentController({
    registry, settings, workspaceDir,
    createProvider: () => new CodexProvider({ callTool: (n, a) => registry.call(n, a), approvals }),
  });
  installAppMenu({ toggleSidebar: () => setSidebarCollapsed(!isSidebarCollapsed()) });
  registerSidebarIpc({ sidebar: sidebar.webContents, setSidebarCollapsed, agent, approvals, settings, history, libraryDir, openPath: appCtx.openPath });
  registerFocusRelay({ ipc: ipcMain, xContentsId: xView.webContents.id, sidebar: sidebar.webContents });

  if (E2E) (globalThis as Record<string, unknown>).__xpilotTest = { windowCount: () => BrowserWindow.getAllWindows().length, registry, xview, bridge, openExternalCalls, settings, xView, sidebar, agent };

  await xView.webContents.loadURL(START_URL);
  if (!E2E) {
    await bridge.waitForReady(20_000).catch(() => console.warn('[xpilot] X view tools not ready; starting agent without them'));
    await agent.start({ resume: true });

    let lastAgentSettings = JSON.stringify(settings.get().agent);
    settings.onChange((s) => {
      const now = JSON.stringify(s.agent);
      if (now === lastAgentSettings) return;
      lastAgentSettings = now;
      void agent.start({ resume: true });
    });
  }
}).catch((err) => {
  console.error('[xpilot] fatal during startup', err);
  dialog.showErrorBox('X Pilot failed to start', String(err));
  app.quit();
});

app.on('window-all-closed', () => app.quit());
