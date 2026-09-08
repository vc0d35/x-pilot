import { app, net, BrowserWindow, dialog, ipcMain, screen, session, shell, type WebContents } from 'electron';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { createMainWindow } from './window';
import { IPC } from '../shared/ipc';
import { fail } from '../shared/tools';
import { pickInitialBounds } from './window-state';
import { installAppMenu } from './menu';
import { configureTouchIdPasskeys, resolveKeychainGroup } from './webauthn';
import { attachNavigationPolicy, POPUP_ONLY_HOSTS } from './navigation/policy';
import { installPermissionHandlers } from './permissions';
import { hardenWebContents } from './hardening';
import { createLinkRouter, rateLimit } from './links';
import { SettingsStore } from './settings';
import { AppToolSource, ToolRegistry } from './tools/registry';
import { WebMcpBridge } from './webmcp/bridge';
import { XViewController } from './xview';
import { BackgroundXView } from './background-view';
import { ApprovalBroker } from './approvals';
import { AgentController } from './agent/controller';
import { TaskManager } from './tasks/manager';
import { TaskRunner } from './tasks/runner';
import { CodexProvider } from './agent/codex/provider';
import { registerSidebarIpc, registerFocusRelay } from './ipc';
import { xviewTools } from './tools/xview';
import type { XViewLike } from './tools/xview/context';
import { DraftStore } from './tools/xview/drafts';
import { HistoryStore } from './history/store';
import { registerHistoryIpc } from './history/ipc';
import { appTools } from './tools/app';
import { exportPdf } from './library/pdf';

/** Development-only switches: a packaged app ignores them however its environment was set. */
const DEV = !app.isPackaged;
const START_URL = (DEV && process.env.XPILOT_START_URL) || 'https://x.com/home';
const E2E = DEV && process.env.XPILOT_E2E === '1';

if (DEV && process.env.XPILOT_USER_DATA) app.setPath('userData', process.env.XPILOT_USER_DATA);
// Opt-in DevTools Protocol endpoint (localhost only) so tooling can inspect the live views: XPILOT_CDP_PORT=9222 npm run dev
if (DEV && process.env.XPILOT_CDP_PORT) app.commandLine.appendSwitch('remote-debugging-port', process.env.XPILOT_CDP_PORT);

app.enableSandbox();

if (!app.requestSingleInstanceLock()) app.quit();
else void start();

async function start(): Promise<void> {
  try {
    await app.whenReady();
    installPermissionHandlers({ x: session.fromPartition('persist:x'), default: session.defaultSession });
    app.on('web-contents-created', (_e, contents) => hardenWebContents(contents));

    const settings = new SettingsStore(join(app.getPath('userData'), 'settings.json'));
    const { win, xView, sidebar, setSidebarCollapsed, isSidebarCollapsed } = createMainWindow({
      bounds: pickInitialBounds(settings.get().window.bounds, screen.getAllDisplays().map((d) => d.workArea)),
      onBoundsChanged: (bounds) => settings.update({ window: { bounds } }),
      preloadX: join(__dirname, '../preload/x.js'),
      preloadSidebar: join(__dirname, '../preload/sidebar.js'),
      rendererUrl: DEV ? process.env.ELECTRON_RENDERER_URL : undefined,
      rendererFile: join(__dirname, '../renderer/index.html'),
    });
    app.on('second-instance', () => { if (win.isMinimized()) win.restore(); win.focus(); });
    configureTouchIdPasskeys({ app, onSelectAccount: (l) => { xView.webContents.session.on('select-webauthn-account', l); }, group: resolveKeychainGroup(process.env, process.platform) });

    const reviveOnCrash = (contents: WebContents, what: string) => {
      contents.on('render-process-gone', (_e, details) => {
        console.warn(`[xpilot] ${what} renderer gone (${details.reason}); reloading`);
        if (!contents.isDestroyed()) contents.reload();
      });
    };
    reviveOnCrash(xView.webContents, 'X view');
    reviveOnCrash(sidebar.webContents, 'sidebar');
    app.on('child-process-gone', (_e, details) => console.warn(`[xpilot] child process gone: ${details.type} (${details.reason})`));

    const openExternalCalls: string[] | null = E2E ? [] : null;
    const openExternal = rateLimit((url: string) => {
      if (openExternalCalls) openExternalCalls.push(url);
      else void shell.openExternal(url);
    }, { max: 5, windowMs: 10_000 });
    const headFetch = async (url: string) => {
      const res = await net.fetch(url, { method: 'HEAD', redirect: 'manual' });
      return { status: res.status, location: res.headers.get('location') };
    };
    const allowHosts = () => settings.get().navigation.allowHosts;
    const links = createLinkRouter({ allowHosts, headFetch, openExternal, loadInView: (url) => { void xView.webContents.loadURL(url); } });
    attachNavigationPolicy(xView.webContents, { allowHosts, openExternal, openShortLink: links.openShortLink });
    // The sidebar is our own renderer: it never navigates and never opens windows.
    sidebar.webContents.on('will-navigate', (e) => e.preventDefault());
    xView.webContents.on('did-create-window', (child) => {
      attachNavigationPolicy(child.webContents, { allowHosts: () => [...allowHosts(), ...POPUP_ONLY_HOSTS], openExternal });
    });

    const approvals = new ApprovalBroker();
    const registry = new ToolRegistry();
    const bridge = new WebMcpBridge(ipcMain, xView.webContents);
    registry.addSource(bridge);
    const xview = new XViewController(xView.webContents, bridge);
    const backgroundOptions = { preload: join(__dirname, '../preload/x.js'), allowHosts, openExternal };
    const background = new BackgroundXView({ ...backgroundOptions,
      onContents: (contents) => { reviveOnCrash(contents, 'background X view'); registerHistoryIpc({ ipc: ipcMain, xContentsId: contents.id, store: history }); } });
    // Scheduled runs get their own hidden window so a run and the user's agent never share one.
    const taskBackground = new BackgroundXView({ ...backgroundOptions,
      onContents: (contents) => { reviveOnCrash(contents, 'scheduled-run X view'); registerHistoryIpc({ ipc: ipcMain, xContentsId: contents.id, store: history }); } });
    app.on('will-quit', () => { background.destroy(); taskBackground.destroy(); });
    registry.addSource(new AppToolSource('xview', xviewTools, {
      xview, background: () => background.get(), allowHosts,
      approvals, postingMode: () => settings.get().posting.mode, likesMode: () => settings.get().likes.mode, drafts: new DraftStore(),
    }));
    registry.onChange(() => console.log('[xpilot] tools:', registry.list().map((t) => t.name).join(', ')));

    const history = new HistoryStore(join(app.getPath('userData'), 'history.sqlite'));
    registerHistoryIpc({ ipc: ipcMain, xContentsId: xView.webContents.id, store: history });
    const libraryDir = () => settings.get().library.dir ?? join(app.getPath('documents'), 'X Pilot');
    const workspaceDir = join(app.getPath('userData'), 'workspace');
    mkdirSync(workspaceDir, { recursive: true });
    const taskRunner = new TaskRunner({
      createProvider: () => new CodexProvider({ callTool: (n, a) => taskRegistry.call(n, a), approvals, clientVersion: app.getVersion() }),
      tools: () => taskRegistry.list(), settings: () => settings.get().agent.codex, workspaceDir, store: history, log: (m) => console.log(m),
    });
    const tasks = new TaskManager({ store: history, run: (t) => taskRunner.run(t).then((status) => { if (taskRunner.lastThreadId) history.updateTask(t.id, { threadId: taskRunner.lastThreadId }); return status; }) });
    const appCtx = {
      history, tasks, libraryDir,
      exportPdf: (url: string, outDir: string) => exportPdf({ url, outDir }, {
        createWindow: () => {
          const w = new BrowserWindow({ show: false, width: 900, height: 1400, webPreferences: { partition: 'persist:x', sandbox: true, contextIsolation: true } });
          attachNavigationPolicy(w.webContents, { allowHosts, openExternal });
          return { loadURL: (u) => w.loadURL(u), executeJavaScript: (c) => w.webContents.executeJavaScript(c, true), printToPDF: (o) => w.webContents.printToPDF(o), destroy: () => w.destroy() };
        },
      }),
      openPath: (p: string) => shell.openPath(p),
    };
    registry.addSource(new AppToolSource('app', appTools, appCtx));

    /**
     * A scheduled run gets the same app tools but never the visible window, and never the
     * page tools of the window the user is looking at.
     */
    const taskXview: XViewLike = {
      currentUrl: () => '',
      navigate: () => Promise.reject(new Error("Scheduled runs cannot move the user's window")),
      callPreload: async () => fail("The user's window is not available in a scheduled run; use background reads"),
    };
    const taskRegistry = new ToolRegistry();
    taskRegistry.addSource(new AppToolSource('xview', xviewTools, {
      xview: taskXview, background: () => taskBackground.get(), allowHosts,
      approvals, postingMode: () => settings.get().posting.mode, likesMode: () => settings.get().likes.mode, drafts: new DraftStore(),
    }));
    taskRegistry.addSource(new AppToolSource('app', appTools, appCtx));
    app.on('will-quit', () => history.close());

    const agent = new AgentController({
      history,
      registry, settings, workspaceDir,
      createProvider: () => new CodexProvider({ callTool: (n, a) => registry.call(n, a), approvals, clientVersion: app.getVersion() }),
    });
    installAppMenu({
      toggleSidebar: () => setSidebarCollapsed(!isSidebarCollapsed()),
      focusAgentInput: () => {
        if (isSidebarCollapsed()) setSidebarCollapsed(false);
        sidebar.webContents.focus();
        sidebar.webContents.send(IPC.sidebarFocusInput);
      },
    });
    registerSidebarIpc({ sidebar: sidebar.webContents, setSidebarCollapsed, openLink: links.openLink, tasks, agent, approvals, settings, history, libraryDir, openPath: appCtx.openPath });
    registerFocusRelay({ ipc: ipcMain, xContentsId: xView.webContents.id, sidebar: sidebar.webContents });

    let ticker: NodeJS.Timeout | null = null;
    let quitting = false;
    app.on('before-quit', (e) => {
      if (quitting) return;
      quitting = true;
      e.preventDefault();
      if (ticker) clearInterval(ticker);
      const deadline = new Promise((resolve) => setTimeout(resolve, 5_000));
      void Promise.race([Promise.all([agent.stop(), tasks.idle()]), deadline])
        .catch((err) => console.warn('[xpilot] shutdown failed', err))
        .finally(() => app.quit());
    });

    if (E2E) (globalThis as Record<string, unknown>).__xpilotTest = { win, tasks, history, windowCount: () => BrowserWindow.getAllWindows().length, registry, xview, bridge, openExternalCalls, settings, xView, sidebar, agent };

    // A first load that fails leaves Chromium's error page up; the app is still usable.
    await xView.webContents.loadURL(START_URL).catch((err) => console.warn('[xpilot] first page load failed', err));
    if (!E2E) {
      await bridge.waitForReady(20_000).catch(() => console.warn('[xpilot] X view tools not ready; starting agent without them'));
      await agent.start({ resume: true });
      // Scheduled tasks run only while the app is open: tick every 30 s.
      ticker = setInterval(() => { void tasks.tick().catch((err) => console.error('[xpilot] task tick failed', err)); }, 30_000);

      let lastAgentSettings = JSON.stringify(settings.get().agent);
      settings.onChange((s) => {
        const now = JSON.stringify(s.agent);
        if (now === lastAgentSettings) return;
        lastAgentSettings = now;
        agent.restartWhenIdle();
      });
    }
  } catch (err) {
    console.error('[xpilot] fatal during startup', err);
    dialog.showErrorBox('X Pilot failed to start', String(err));
    app.quit();
  }
}

app.on('window-all-closed', () => app.quit());
