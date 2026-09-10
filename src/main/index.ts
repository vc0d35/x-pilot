import { app, BrowserWindow, dialog, protocol } from 'electron';
import { join } from 'node:path';
import { APP_SCHEME, hasBannedSwitch } from './hardening';
import { createApp, resolveDevSwitches } from './bootstrap';

/**
 * Main is a long-lived process holding the user's window, their agent and their session; a stray
 * rejection out of a timer or a WebContents that went away is not a reason to lose all of it. Both
 * are logged with their stack and swallowed: a crash that prints nothing is a crash nobody can fix,
 * and CI in particular only ever sees what was written here.
 */
process.on('uncaughtException', (err) => console.error('[xpilot] uncaught exception in main', err));
process.on('unhandledRejection', (reason) => console.error('[xpilot] unhandled rejection in main', reason));

const DEV = !app.isPackaged;
const dev = resolveDevSwitches(process.env, DEV);

if (dev.userData) app.setPath('userData', dev.userData);
// Opt-in DevTools Protocol endpoint (localhost only) so tooling can inspect the live views: XPILOT_CDP_PORT=9222 npm run dev
if (dev.cdpPort) app.commandLine.appendSwitch('remote-debugging-port', dev.cdpPort);

if (!DEV && hasBannedSwitch(process.argv.slice(1))) process.exit(1);

// X pauses its feeds when the page reports itself hidden, which Chromium does for an occluded window.
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

app.enableSandbox();

// Has to happen before the app is ready. A standard, secure scheme gives the sidebar a real origin,
// so the production CSP's 'self' covers its bundle and fonts and the file: fuse can stay off.
// corsEnabled is what lets a custom view (xpilot://views/<name>) import a module from the library
// shelf (xpilot://lib): a module import is a CORS request, and without it Chromium refuses every
// cross-origin request on a non-http scheme outright. Only the shelf answers with an allow-origin
// header, so a view's own files stay unreadable from anywhere else.
protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

if (!app.requestSingleInstanceLock()) app.quit();
else void start();

for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => app.quit());

async function start(): Promise<void> {
  try {
    await app.whenReady();
    const xpilot = createApp({
      userData: app.getPath('userData'),
      outDir: join(__dirname, '..'),
      startUrl: dev.startUrl,
      sidebarUrl: dev.sidebarUrl,
      e2e: dev.e2e,
    });
    if (dev.e2e)
      (globalThis as Record<string, unknown>).__xpilotTest = {
        win: xpilot.win,
        tasks: xpilot.tasks,
        store: xpilot.store,
        windowCount: () => BrowserWindow.getAllWindows().length,
        registry: xpilot.registry,
        xview: xpilot.xview,
        bridge: xpilot.bridge,
        openExternalCalls: xpilot.openExternalCalls,
        settings: xpilot.settings,
        approvals: xpilot.approvals,
        styles: xpilot.styles,
        selectors: xpilot.selectors,
        xView: xpilot.xView,
        sidebar: xpilot.sidebar,
        agent: xpilot.agent,
        views: xpilot.views,
        viewCanvas: xpilot.viewCanvas,
      };
    await xpilot.launch();
  } catch (err) {
    console.error('[xpilot] fatal during startup', err);
    dialog.showErrorBox('XPilot failed to start', String(err));
    app.quit();
  }
}

app.on('window-all-closed', () => app.quit());
