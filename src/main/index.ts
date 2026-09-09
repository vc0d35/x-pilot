import { app, net, BrowserWindow, dialog, ipcMain, screen, session, shell } from 'electron';
import { join } from 'node:path';
import { chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createMainWindow } from './window';
import { IPC } from '../shared/ipc';
import { fail } from '../shared/tools';
import { pickInitialBounds } from './window-state';
import { installAppMenu } from './menu';
import { configureTouchIdPasskeys, resolveKeychainGroup } from './webauthn';
import { attachNavigationPolicy, POPUP_ONLY_HOSTS } from './navigation/policy';
import { installPermissionHandlers } from './permissions';
import { hardenWebContents, reviveOnCrash } from './hardening';
import { createLinkRouter, rateLimit } from './links';
import { SettingsStore } from './settings';
import { AppToolSource, ToolRegistry } from './tools/registry';
import { AdapterBridge } from './adapter/bridge';
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

for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => app.quit());

async function start(): Promise<void> {
  try {
    await app.whenReady();
    // The profile holds the X session, the agent's settings and its history: keep it to this user.
    const userData = app.getPath('userData');
    restrictDir(userData);
    const workspaceDir = join(userData, 'workspace');
    restrictDir(workspaceDir);

    const settings = new SettingsStore(join(userData, 'settings.json'));
    const allowHosts = () => settings.get().navigation.allowHosts;
    const openExternalCalls: string[] | null = E2E ? [] : null;
    const openExternal = rateLimit((url: string) => {
      if (openExternalCalls) openExternalCalls.push(url);
      else void shell.openExternal(url);
    }, { max: 5, windowMs: 10_000 });

    installPermissionHandlers({ x: session.fromPartition('persist:x'), default: session.defaultSession, allowHosts });
    // Every WebContents, however it came to exist, gets the navigation policy: grandchild popups and
    // the PDF export window are covered here rather than by per-site wiring nobody remembers to add.
    app.on('web-contents-created', (_e, contents) => hardenWebContents(contents, (c) => attachNavigationPolicy(c, { allowHosts, openExternal })));

    const { win, xView, sidebar, setSidebarCollapsed, isSidebarCollapsed } = createMainWindow({
      bounds: pickInitialBounds(settings.get().window.bounds, screen.getAllDisplays().map((d) => d.workArea)),
      onBoundsChanged: (bounds) => settings.update({ window: { bounds } }),
      preloadX: join(__dirname, '../preload/x.js'),
      preloadSidebar: join(__dirname, '../preload/sidebar.js'),
      rendererUrl: DEV ? process.env.ELECTRON_RENDERER_URL : undefined,
      rendererFile: join(__dirname, '../renderer/index.html'),
    });
    app.on('second-instance', () => { if (win.isMinimized()) win.restore(); win.focus(); });
    configureTouchIdPasskeys({ app, onSelectAccount: (l) => { xView.webContents.session.on('select-webauthn-account', l); }, group: resolveKeychainGroup(process.env, process.platform, { packaged: app.isPackaged, bundleTeamId: bundleTeamId() }) });

    reviveOnCrash(xView.webContents, 'X view');
    reviveOnCrash(sidebar.webContents, 'sidebar');
    app.on('child-process-gone', (_e, details) => console.warn(`[xpilot] child process gone: ${details.type} (${details.reason})`));

    const links = createLinkRouter({ allowHosts, headFetch, openExternal, loadInView: (url) => { void xView.webContents.loadURL(url); } });
    attachNavigationPolicy(xView.webContents, { allowHosts, openExternal, openShortLink: links.openShortLink });
    // The sidebar is our own renderer: it never navigates and never opens windows.
    sidebar.webContents.on('will-navigate', (e) => e.preventDefault());
    xView.webContents.on('did-create-window', (child) => {
      attachNavigationPolicy(child.webContents, { allowHosts: () => [...allowHosts(), ...POPUP_ONLY_HOSTS], openExternal });
    });

    const approvals = new ApprovalBroker();
    const registry = new ToolRegistry();
    const bridge = new AdapterBridge(ipcMain, xView.webContents);
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

    const historyPath = join(userData, 'history.sqlite');
    const history = new HistoryStore(historyPath);
    // node:sqlite creates the database and its write-ahead log with the process umask; the log
    // holds the same rows as the database, so all three are narrowed once they exist.
    for (const suffix of ['', '-wal', '-shm']) restrictFile(`${historyPath}${suffix}`);
    registerHistoryIpc({ ipc: ipcMain, xContentsId: xView.webContents.id, store: history });
    const libraryDir = () => settings.get().library.dir ?? join(app.getPath('documents'), 'X Pilot');
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
          // The global hook already attached the policy; an unattended export opens nothing at all.
          attachNavigationPolicy(w.webContents, { allowHosts, openExternal: () => { /* an export never opens the browser */ } });
          w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
          return { loadURL: (u) => w.loadURL(u), executeJavaScript: (c) => w.webContents.executeJavaScript(c, true), printToPDF: (o) => w.webContents.printToPDF(o), getURL: () => w.webContents.getURL(), destroy: () => w.destroy() };
        },
      }),
      openPath: (p: string) => shell.openPath(p),
    };
    registry.addSource(new AppToolSource('app', appTools, appCtx));

    // A scheduled run gets the app tools but never the visible window, nor its adapter tools.
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
      openExternal,
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
    dialog.showErrorBox('XPilot failed to start', String(err));
    app.quit();
  }
}

app.on('window-all-closed', () => app.quit());

/** Creates a profile directory the user alone can enter, or narrows one an older build left open. */
function restrictDir(dir: string): void {
  try {
    if (existsSync(dir)) chmodSync(dir, 0o700);
    else mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch (err) {
    console.warn(`[xpilot] could not restrict ${dir}`, err);
  }
}

function restrictFile(file: string): void {
  try {
    chmodSync(file, 0o600);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.warn(`[xpilot] could not restrict ${file}`, err);
  }
}

/**
 * The Apple team id electron-builder baked into the packaged app's own package.json. It has to match
 * the signing identity or the app is SIGKILLed at launch, which is what makes it bundle identity.
 */
function bundleTeamId(): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8')) as { xpilotTeamId?: string };
    const team = pkg.xpilotTeamId?.trim();
    return team && /^[A-Z0-9]{10}$/.test(team) ? team : null;
  } catch {
    return null;
  }
}

/**
 * A HEAD that reports the redirect instead of following it. `net.fetch` with `redirect: 'manual'`
 * throws on a redirect rather than returning it, so the resolver is built on `net.request`, which
 * also gives the per-hop timeout somewhere to abort.
 */
function headFetch(url: string, timeoutMs = 5_000): Promise<{ status: number; location: string | null }> {
  return new Promise((resolve, reject) => {
    const request = net.request({ url, method: 'HEAD', redirect: 'manual' });
    let settled = false;
    const finish = (act: () => void) => { if (settled) return; settled = true; clearTimeout(timer); act(); };
    const timer = setTimeout(() => finish(() => { request.abort(); reject(new Error(`HEAD ${url} timed out`)); }), timeoutMs);
    request.on('redirect', (status, _method, redirectUrl) => finish(() => { request.abort(); resolve({ status, location: redirectUrl }); }));
    // A HEAD has no body worth reading, but the response is drained so the socket is released.
    request.on('response', (response) => { response.on('data', () => {}); finish(() => resolve({ status: response.statusCode, location: null })); });
    request.on('error', (err) => finish(() => reject(err)));
    request.end();
  });
}
