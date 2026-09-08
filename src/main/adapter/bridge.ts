import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { IPC } from '../../shared/ipc';
import { fail, ToolResultSchema, ToolSpecSchema, type ToolResult, type ToolSpec } from '../../shared/tools';
import type { ToolSource } from '../tools/registry';

export interface BridgeIpc { on(channel: string, listener: (event: { sender: { id: number } }, payload: unknown) => void): void }
export interface NavigationDetails { isMainFrame: boolean; isSameDocument: boolean }
export interface BridgeTarget {
  id: number;
  send(channel: string, payload: unknown): void;
  on?(event: 'did-start-navigation', listener: (details: NavigationDetails) => void): unknown;
}

const RegisterSchema = z.object({ tools: z.array(ToolSpecSchema) });
const ResultSchema = z.object({ callId: z.string(), result: ToolResultSchema });

const CALL_READY_TIMEOUT_MS = 10_000;

export class AdapterBridge implements ToolSource {
  readonly id = 'adapter';
  /**
   * Last-known specs, kept across navigations: the preload registers a compile-time constant tool
   * set, so the list stays true while a page reloads. Agent threads snapshot the tool list once, at
   * thread start, and would otherwise start with no adapter tools when they open mid-navigation.
   */
  private tools: ToolSpec[] = [];
  private ready = false;
  private readonly pending = new Map<string, { resolve: (r: ToolResult) => void; timer: NodeJS.Timeout }>();
  private readonly listeners = new Set<() => void>();
  private readyWaiters: Array<() => void> = [];

  constructor(ipc: BridgeIpc, private readonly target: BridgeTarget, private readonly timeoutMs = 20_000) {
    ipc.on(IPC.adapterRegister, (event, payload) => {
      if (event.sender.id !== target.id) return;
      const parsed = RegisterSchema.safeParse(payload);
      if (!parsed.success) return;
      this.tools = parsed.data.tools;
      this.ready = true;
      for (const cb of this.listeners) cb();
      for (const w of this.readyWaiters.splice(0)) w();
    });
    ipc.on(IPC.adapterResult, (event, payload) => {
      if (event.sender.id !== target.id) return;
      const parsed = ResultSchema.safeParse(payload);
      if (!parsed.success) return;
      const p = this.pending.get(parsed.data.callId);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(parsed.data.callId);
      p.resolve(parsed.data.result);
    });
    target.on?.('did-start-navigation', (details) => {
      if (!details?.isMainFrame || details.isSameDocument) return;
      this.ready = false;
      this.rejectPending('The page navigated during the call; retry once it has loaded');
    });
  }

  list(): ToolSpec[] { return this.tools; }

  async call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (!this.tools.some((t) => t.name === name)) return fail(`Unknown tool: ${name}`);
    if (!this.ready) {
      const back = await this.waitForReady(CALL_READY_TIMEOUT_MS).then(() => true, () => false);
      if (!back) return fail(`The page is still loading and did not register its tools; ${name} was not run. Retry once it has loaded.`);
    }
    const callId = randomUUID();
    return new Promise<ToolResult>((resolve) => {
      const timer = setTimeout(() => { this.pending.delete(callId); resolve(fail(`Adapter tool call timed out: ${name}`)); }, this.timeoutMs);
      this.pending.set(callId, { resolve, timer });
      this.target.send(IPC.adapterCall, { callId, name, args });
    });
  }

  onChange(cb: () => void): () => void { this.listeners.add(cb); return () => this.listeners.delete(cb); }

  /** Call right before loading a new URL so waitForReady waits for the fresh preload. */
  markNavigating(): void { this.ready = false; }

  waitForReady(timeoutMs = 15_000): Promise<void> {
    if (this.ready) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.readyWaiters = this.readyWaiters.filter((w) => w !== done);
        reject(new Error('X view did not register tools in time'));
      }, timeoutMs);
      const done = () => { clearTimeout(timer); resolve(); };
      this.readyWaiters.push(done);
    });
  }

  private rejectPending(message: string): void {
    for (const [callId, p] of [...this.pending]) {
      clearTimeout(p.timer);
      this.pending.delete(callId);
      p.resolve(fail(message));
    }
  }
}
