import type { WebContents } from 'electron';
import type { ToolResult } from '../shared/tools';
import type { WebMcpBridge } from './webmcp/bridge';

export class XViewController {
  constructor(private readonly contents: WebContents, private readonly bridge: WebMcpBridge) {}

  currentUrl(): string { return this.contents.getURL(); }

  /** Full navigation of the X view; resolves once the new preload has registered its tools. */
  async navigate(url: string): Promise<void> {
    this.bridge.markNavigating();
    try {
      await this.contents.loadURL(url);
    } catch (err) {
      // ERR_ABORTED happens when x.com immediately redirects (e.g. /i/... -> /...); the new load still completes.
      if (!(err instanceof Error && /ERR_ABORTED/.test(err.message))) throw err;
    }
    await this.bridge.waitForReady();
  }

  callPreload(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    return this.bridge.call(name, args);
  }
}
