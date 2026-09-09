import { app, net, BrowserWindow, ipcMain, protocol, screen, session, shell } from 'electron';
import { join } from 'node:path';
import { chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { BaseWindow, WebContentsView } from 'electron';
import { createMainWindow } from './window';
import { IPC } from '../shared/ipc';
import { fail } from '../shared/tools';
import { LIBRARY_FOLDER_NAME } from '../shared/constants';
import { pickInitialBounds } from './window-state';
import { installAppMenu } from './menu';
import { configureTouchIdPasskeys, resolveKeychainGroup } from './webauthn';
import { attachNavigationPolicy, POPUP_ONLY_HOSTS } from './navigation/policy';
import { installPermissionHandlers } from './permissions';
import { APP_SCHEME, SIDEBAR_URL, hardenWebContents, resolveSidebarAsset, reviveOnCrash } from './hardening';
import { createLinkRouter, rateLimit, type LinkRouter } from './links';
import { SettingsStore } from './settings';
import { AppToolSource, ToolRegistry } from './tools/registry';
import { AdapterBridge } from './adapter/bridge';
import { adapterToolSpecs } from '../preload/x/adapter/tools/specs';
import { XViewController } from './xview';
import { BackgroundXView } from './background-view';
import { ApprovalBroker } from './approvals';
import { UserInputBroker } from './user-input';
import { AgentController } from './agent/controller';
import { ThreadState } from './agent/thread-state';
import { TaskManager } from './tasks/manager';
import { TaskRunner } from './tasks/runner';
import { CodexProvider } from './agent/codex/provider';
import { registerSidebarIpc, registerFocusRelay } from './ipc';
import { xviewTools } from './tools/xview';
import type { XViewLike } from './tools/xview/context';
import { DraftStore } from './tools/xview/drafts';
import { AppStore } from './history/store';
import { registerHistoryIpc } from './history/ipc';
import { appTools } from './tools/app';
import { exportPdf } from './library/pdf';

/** Tools that create or change scheduled tasks: a scheduled run may not reschedule itself or its peers. */
const TASK_MANAGEMENT_TOOLS = new Set(['xpilot_schedule_task', 'xpilot_update_task', 'xpilot_delete_task']);

export function toolsForScheduledRuns<T extends { spec: { name: string } }>(tools: readonly T[]): T[] {
  return tools.filter((t) => !TASK_MANAGEMENT_TOOLS.has(t.spec.name));
}

export interface DevSwitches {
  /** A profile directory to use instead of the default one. */
  userData: string | null;
  /** A localhost DevTools Protocol port to open. */
  cdpPort: string | null;
  startUrl: string;
  sidebarUrl: string;
  e2e: boolean;
}

/** A packaged app ignores every one of these, however its environment was set. */
export function resolveDevSwitches(env: NodeJS.ProcessEnv, dev: boolean): DevSwitches {
  const on = (name: string) => (dev ? env[name] || null : null);
  return {
    userData: on('XPILOT_USER_DATA'),
    cdpPort: on('XPILOT_CDP_PORT'),
    startUrl: on('XPILOT_START_URL') ?? 'https://x.com/home',
    sidebarUrl: on('ELECTRON_RENDERER_URL') ?? SIDEBAR_URL,
    e2e: on('XPILOT_E2E') === '1',
  };
}

export interface AppOptions {
  /** The profile directory: the X session, the settings and the database live here. */
  userData: string;
  /** Where the built sidebar bundle and the preloads are, normally `out/`. */
  outDir: string;
  startUrl: string;
  sidebarUrl: string;
  e2e: boolean;
}

export interface XPilotApp {
  win: BaseWindow;
  xView: WebContentsView;
  sidebar: WebContentsView;
  xview: XViewController;
  registry: ToolRegistry;
  taskRegistry: ToolRegistry;
  agent: AgentController;
  tasks: TaskManager;
  store: AppStore;
  bridge: AdapterBridge;
  links: LinkRouter;
  settings: SettingsStore;
  /** In an e2e run, the links that would have gone to the system browser; null otherwise. */
  openExternalCalls: string[] | null;
  /** Loads the first page and, outside e2e, starts the agent and the task ticker. */
  launch(): Promise<void>;
  shutdown(): Promise<void>;
}

/**
 * Builds the whole object graph, top to bottom in the order things come to exist: profile, sidebar
 * scheme, settings, windows, navigation, tools, database, tasks, agent, IPC, quit sequencing.
 */
export function createApp(opts: AppOptions): XPilotApp {
  // The profile holds the X session, the agent's settings and its history: keep it to this user.
  restrictDir(opts.userData);
  const workspaceDir = join(opts.userData, 'workspace');
  restrictDir(workspaceDir);

  const rendererDir = join(opts.outDir, 'renderer');
  protocol.handle(APP_SCHEME, async (request) => {
    const asset = resolveSidebarAsset(rendererDir, request.url);
    if (!asset) return new Response('Not found', { status: 404 });
    try {
      return new Response(await readFile(asset.path), { headers: { 'content-type': asset.contentType } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });

  const settings = new SettingsStore(join(opts.userData, 'settings.json'));
  // The live thread id is the agent's own bookkeeping, kept beside settings.json; retention reads it
  // here and the controller writes it, so both must share one instance.
  const threadState = ThreadState.beside(settings.filePath);
  const allowHosts = () => settings.get().navigation.allowHosts;
  const openExternalCalls: string[] | null = opts.e2e ? [] : null;
  const openExternal = rateLimit(
    (url: string) => {
      if (openExternalCalls) openExternalCalls.push(url);
      else void shell.openExternal(url);
    },
    { max: 5, windowMs: 10_000 },
  );

  installPermissionHandlers({ x: session.fromPartition('persist:x'), default: session.defaultSession, allowHosts });
  // Every WebContents, however it came to exist, gets the navigation policy: grandchild popups and
  // the PDF export window are covered here rather than by per-site wiring nobody remembers to add.
  app.on('web-contents-created', (_e, contents) =>
    hardenWebContents(contents, (c) => attachNavigationPolicy(c, { allowHosts, openExternal })),
  );

  const preloadX = join(opts.outDir, 'preload/x.js');
  const { win, xView, sidebar, setSidebarCollapsed, isSidebarCollapsed } = createMainWindow({
    bounds: pickInitialBounds(
      settings.get().window.bounds,
      screen.getAllDisplays().map((d) => d.workArea),
    ),
    onBoundsChanged: (bounds) => settings.update({ window: { bounds } }),
    preloadX,
    preloadSidebar: join(opts.outDir, 'preload/sidebar.js'),
    sidebarUrl: opts.sidebarUrl,
  });
  app.on('second-instance', () => {
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  configureTouchIdPasskeys({
    app,
    onSelectAccount: (l) => {
      xView.webContents.session.on('select-webauthn-account', l);
    },
    group: resolveKeychainGroup(process.env, process.platform, { packaged: app.isPackaged, bundleTeamId: bundleTeamId() }),
  });

  reviveOnCrash(xView.webContents, 'X view');
  reviveOnCrash(sidebar.webContents, 'sidebar');
  app.on('child-process-gone', (_e, details) => console.warn(`[xpilot] child process gone: ${details.type} (${details.reason})`));

  const links = createLinkRouter({
    allowHosts,
    headFetch,
    openExternal,
    loadInView: (url) => {
      void xView.webContents.loadURL(url);
    },
  });
  attachNavigationPolicy(xView.webContents, { allowHosts, openExternal, openShortLink: links.openShortLink });
  // The sidebar is our own renderer: it never navigates and never opens windows.
  sidebar.webContents.on('will-navigate', (e) => e.preventDefault());
  xView.webContents.on('did-create-window', (child) => {
    attachNavigationPolicy(child.webContents, { allowHosts: () => [...allowHosts(), ...POPUP_ONLY_HOSTS], openExternal });
  });

  const approvals = new ApprovalBroker();
  const userInput = new UserInputBroker();
  const registry = new ToolRegistry();
  const bridge = new AdapterBridge(ipcMain, xView.webContents, { staticSpecs: adapterToolSpecs });
  registry.addSource(bridge);
  const xview = new XViewController(xView.webContents, bridge);
  const backgroundOptions = { preload: preloadX, allowHosts, openExternal };
  const background = new BackgroundXView({
    ...backgroundOptions,
    onContents: (contents) => {
      reviveOnCrash(contents, 'background X view');
      registerHistoryIpc({ ipc: ipcMain, xContentsId: contents.id, store });
    },
  });
  // Scheduled runs get their own hidden window so a run and the user's agent never share one.
  const taskBackground = new BackgroundXView({
    ...backgroundOptions,
    onContents: (contents) => {
      reviveOnCrash(contents, 'scheduled-run X view');
      registerHistoryIpc({ ipc: ipcMain, xContentsId: contents.id, store });
    },
  });
  app.on('will-quit', () => {
    background.destroy();
    taskBackground.destroy();
  });
  registry.addSource(
    new AppToolSource('xview', xviewTools, {
      xview,
      background: () => background.get(),
      allowHosts,
      approvals,
      postingMode: () => settings.get().posting.mode,
      likesMode: () => settings.get().likes.mode,
      drafts: new DraftStore(),
    }),
  );
  registry.onChange(() =>
    console.log(
      '[xpilot] tools:',
      registry
        .list()
        .map((t) => t.name)
        .join(', '),
    ),
  );

  const historyPath = join(opts.userData, 'history.sqlite');
  const store = new AppStore(historyPath);
  // node:sqlite creates the database and its write-ahead log with the process umask; the log
  // holds the same rows as the database, so all three are narrowed once they exist.
  for (const suffix of ['', '-wal', '-shm']) restrictFile(`${historyPath}${suffix}`);
  registerHistoryIpc({ ipc: ipcMain, xContentsId: xView.webContents.id, store });
  // The transcript grows with every turn, so retention runs once at startup and then on a slow
  // timer: an app left open for weeks prunes itself without waiting for a restart.
  const applyRetention = () => {
    try {
      const removed = store.applyRetention({ ...settings.get().history, keepThreadId: threadState.get().threadId });
      if (removed.conversations)
        console.log(`[xpilot] history retention: removed ${removed.conversations} conversations (${removed.events} events)`);
    } catch (err) {
      console.warn('[xpilot] history retention failed', err);
    }
  };
  applyRetention();
  const retentionTimer = setInterval(applyRetention, 6 * 60 * 60 * 1000);
  app.on('will-quit', () => clearInterval(retentionTimer));
  const libraryDir = () => settings.get().library.dir ?? join(app.getPath('documents'), LIBRARY_FOLDER_NAME);
  const taskRunner = new TaskRunner({
    createProvider: () =>
      new CodexProvider({ callTool: (n, a, signal) => taskRegistry.call(n, a, { signal }), approvals, clientVersion: app.getVersion() }),
    tools: () => taskRegistry.list(),
    settings: () => settings.get().agent.codex,
    workspaceDir,
    store,
    log: (m) => console.log(m),
  });
  const tasks = new TaskManager({
    store,
    run: (t) =>
      taskRunner.run(t).then((status) => {
        if (taskRunner.lastThreadId) store.updateTask(t.id, { threadId: taskRunner.lastThreadId });
        return status;
      }),
  });
  const appCtx = {
    store,
    tasks,
    libraryDir,
    exportPdf: (url: string, outDir: string) =>
      exportPdf(
        { url, outDir },
        {
          createWindow: () => {
            const w = new BrowserWindow({
              show: false,
              width: 900,
              height: 1400,
              webPreferences: { partition: 'persist:x', sandbox: true, contextIsolation: true },
            });
            // The global hook already attached the policy; an unattended export opens nothing at all.
            attachNavigationPolicy(w.webContents, {
              allowHosts,
              openExternal: () => {
                /* an export never opens the browser */
              },
            });
            w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
            return {
              loadURL: (u) => w.loadURL(u),
              executeJavaScript: (c) => w.webContents.executeJavaScript(c, true),
              printToPDF: (o) => w.webContents.printToPDF(o),
              getURL: () => w.webContents.getURL(),
              destroy: () => w.destroy(),
            };
          },
        },
      ),
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
  taskRegistry.addSource(
    new AppToolSource('xview', xviewTools, {
      xview: taskXview,
      background: () => taskBackground.get(),
      allowHosts,
      approvals,
      postingMode: () => settings.get().posting.mode,
      likesMode: () => settings.get().likes.mode,
      drafts: new DraftStore(),
    }),
  );
  taskRegistry.addSource(new AppToolSource('app', toolsForScheduledRuns(appTools), appCtx));
  app.on('will-quit', () => store.close());

  const agent = new AgentController({
    store,
    threadState,
    registry,
    settings,
    workspaceDir,
    createProvider: () =>
      new CodexProvider({
        callTool: (n, a, signal) => registry.call(n, a, { signal }),
        approvals,
        userInput,
        clientVersion: app.getVersion(),
      }),
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
  registerSidebarIpc({
    sidebar: sidebar.webContents,
    setSidebarCollapsed,
    openLink: links.openLink,
    tasks,
    agent,
    approvals,
    userInput,
    settings,
    store,
    libraryDir,
    openPath: appCtx.openPath,
  });
  registerFocusRelay({ ipc: ipcMain, xContentsId: xView.webContents.id, sidebar: sidebar.webContents });

  let ticker: NodeJS.Timeout | null = null;
  let quitting = false;
  const shutdown = async (): Promise<void> => {
    if (ticker) clearInterval(ticker);
    clearInterval(retentionTimer);
    const deadline = new Promise((resolve) => setTimeout(resolve, 5_000));
    await Promise.race([Promise.all([agent.stop(), tasks.idle()]), deadline]).catch((err) => console.warn('[xpilot] shutdown failed', err));
  };
  app.on('before-quit', (e) => {
    if (quitting) return;
    quitting = true;
    e.preventDefault();
    void shutdown().finally(() => app.quit());
  });

  const launch = async (): Promise<void> => {
    // A first load that fails leaves Chromium's error page up; the app is still usable.
    await xView.webContents.loadURL(opts.startUrl).catch((err) => console.warn('[xpilot] first page load failed', err));
    if (opts.e2e) return;
    await bridge.waitForReady(20_000).catch(() => console.warn('[xpilot] X view tools not ready; starting agent without them'));
    await agent.start({ resume: true });
    // Scheduled tasks run only while the app is open: tick every 30 s.
    ticker = setInterval(() => {
      void tasks.tick().catch((err) => console.error('[xpilot] task tick failed', err));
    }, 30_000);

    let lastAgentSettings = JSON.stringify(settings.get().agent);
    settings.onChange((s) => {
      const now = JSON.stringify(s.agent);
      if (now === lastAgentSettings) return;
      lastAgentSettings = now;
      agent.restartWhenIdle();
    });
  };

  return {
    win,
    xView,
    sidebar,
    xview,
    registry,
    taskRegistry,
    agent,
    tasks,
    store,
    bridge,
    links,
    settings,
    openExternalCalls,
    launch,
    shutdown,
  };
}

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
    const finish = (act: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      act();
    };
    const timer = setTimeout(
      () =>
        finish(() => {
          request.abort();
          reject(new Error(`HEAD ${url} timed out`));
        }),
      timeoutMs,
    );
    request.on('redirect', (status, _method, redirectUrl) =>
      finish(() => {
        request.abort();
        resolve({ status, location: redirectUrl });
      }),
    );
    // A HEAD has no body worth reading, but the response is drained so the socket is released.
    request.on('response', (response) => {
      response.on('data', () => {});
      finish(() => resolve({ status: response.statusCode, location: null }));
    });
    request.on('error', (err) => finish(() => reject(err)));
    request.end();
  });
}
