import { BrowserWindow, ipcMain, type WebContents } from 'electron';
import { attachNavigationPolicy } from './navigation/policy';
import { WebMcpBridge } from './webmcp/bridge';
import { XViewController } from './xview';

/**
 * A hidden window on the `persist:x` session running the same X preload as the visible
 * view. Read tools use it so research never moves the user's screen. Its like/focus IPC
 * is relayed only where main opts in (likes made here count as the user's), and its tools are not registered with the agent;
 * it is only reachable through the controller returned by `get()`.
 */
export class BackgroundXView {
  private win: BrowserWindow | null = null;
  private controller: XViewController | null = null;

  constructor(private readonly opts: { preload: string; allowHosts(): string[]; openExternal(url: string): void; onContents?(contents: WebContents): void }) {}

  async get(): Promise<XViewController> {
    if (this.controller && this.win && !this.win.isDestroyed()) return this.controller;
    const win = new BrowserWindow({
      show: false, width: 1100, height: 1400,
      webPreferences: { partition: 'persist:x', preload: this.opts.preload, contextIsolation: true, nodeIntegration: false, sandbox: false },
    });
    const contents: WebContents = win.webContents;
    attachNavigationPolicy(contents, { allowHosts: this.opts.allowHosts, openExternal: () => { /* background reads never open external pages */ } });
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.opts.onContents?.(contents);
    const bridge = new WebMcpBridge(ipcMain, contents);
    this.win = win;
    this.controller = new XViewController(contents, bridge);
    win.on('closed', () => { this.win = null; this.controller = null; });
    return this.controller;
  }

  destroy(): void { if (this.win && !this.win.isDestroyed()) this.win.destroy(); this.win = null; this.controller = null; }
}
