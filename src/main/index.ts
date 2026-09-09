import { app, BrowserWindow, dialog, protocol } from 'electron';
import { join } from 'node:path';
import { APP_SCHEME, hasBannedSwitch } from './hardening';
import { createApp, resolveDevSwitches } from './bootstrap';

const DEV = !app.isPackaged;
const dev = resolveDevSwitches(process.env, DEV);

if (dev.userData) app.setPath('userData', dev.userData);
// Opt-in DevTools Protocol endpoint (localhost only) so tooling can inspect the live views: XPILOT_CDP_PORT=9222 npm run dev
if (dev.cdpPort) app.commandLine.appendSwitch('remote-debugging-port', dev.cdpPort);

if (!DEV && hasBannedSwitch(process.argv.slice(1))) process.exit(1);

app.enableSandbox();

// Has to happen before the app is ready. A standard, secure scheme gives the sidebar a real origin,
// so the production CSP's 'self' covers its bundle and fonts and the file: fuse can stay off.
protocol.registerSchemesAsPrivileged([{ scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

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
      };
    await xpilot.launch();
  } catch (err) {
    console.error('[xpilot] fatal during startup', err);
    dialog.showErrorBox('XPilot failed to start', String(err));
    app.quit();
  }
}

app.on('window-all-closed', () => app.quit());
