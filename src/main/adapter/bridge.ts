import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { IPC } from '../../shared/ipc';
import { fail, ToolResultSchema, ToolSpecSchema, type ToolCallOptions, type ToolResult, type ToolSpec } from '../../shared/tools';
import type { ToolSource } from '../tools/registry';

export interface BridgeIpc {
  on(channel: string, listener: (event: { sender: { id: number } }, payload: unknown) => void): void;
}
export interface NavigationDetails {
  isMainFrame: boolean;
  isSameDocument: boolean;
}
export interface BridgeTarget {
  id: number;
  send(channel: string, payload: unknown): void;
  on?(event: 'did-start-navigation', listener: (details: NavigationDetails) => void): unknown;
}

export interface BridgeOptions {
  /** The adapter's tool surface as a compile-time constant, from `src/preload/x/adapter/tools/specs`. */
  staticSpecs?: ToolSpec[];
  timeoutMs?: number;
  log?: (message: string) => void;
}

const RegisterSchema = z.object({ tools: z.array(ToolSpecSchema) });
const ResultSchema = z.object({ callId: z.string(), result: ToolResultSchema });

const CALL_READY_TIMEOUT_MS = 10_000;
export const CANCELLED = 'Cancelled';

export class AdapterBridge implements ToolSource {
  readonly id = 'adapter';
  /**
   * The tool list is a constant of this build, not something the page teaches us: an agent thread
   * snapshots the tools once at thread start, and would otherwise start with none when it opens
   * before the X view has loaded. Registration only says the preload is there to answer calls.
   */
  private readonly specs: ToolSpec[];
  private readonly timeoutMs: number;
  private readonly log: (message: string) => void;
  private ready = false;
  private readonly pending = new Map<string, { resolve: (r: ToolResult) => void; timer: NodeJS.Timeout }>();
  private readonly listeners = new Set<() => void>();
  private readyWaiters: Array<() => void> = [];

  constructor(
    ipc: BridgeIpc,
    private readonly target: BridgeTarget,
    opts: BridgeOptions = {},
  ) {
    this.specs = opts.staticSpecs ?? [];
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.log = opts.log ?? ((m) => console.warn(m));
    ipc.on(IPC.adapterRegister, (event, payload) => {
      if (event.sender.id !== target.id) return;
      const parsed = RegisterSchema.safeParse(payload);
      if (!parsed.success) return;
      this.verify(parsed.data.tools);
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

  list(): ToolSpec[] {
    return this.specs;
  }

  /** The preload's tools take no call context: a page adapter reads and clicks, it never asks the user. */
  async call(name: string, args: Record<string, unknown>, opts?: ToolCallOptions): Promise<ToolResult> {
    const signal = opts?.signal;
    if (!this.specs.some((t) => t.name === name)) return fail(`Unknown tool: ${name}`);
    if (signal?.aborted) return fail(CANCELLED);
    if (!this.ready) {
      const back = await this.waitForReady(CALL_READY_TIMEOUT_MS, signal).then(
        () => true,
        () => false,
      );
      if (signal?.aborted) return fail(CANCELLED);
      if (!back) return fail(`The page is still loading and did not register its tools; ${name} was not run. Retry once it has loaded.`);
    }
    const callId = randomUUID();
    return new Promise<ToolResult>((resolve) => {
      const settle = (r: ToolResult) => {
        if (!this.pending.delete(callId)) return;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve(r);
      };
      const timer = setTimeout(() => settle(fail(`Adapter tool call timed out: ${name}`)), this.timeoutMs);
      const onAbort = () => settle(fail(CANCELLED));
      this.pending.set(callId, {
        resolve: (r) => {
          signal?.removeEventListener('abort', onAbort);
          resolve(r);
        },
        timer,
      });
      signal?.addEventListener('abort', onAbort, { once: true });
      this.target.send(IPC.adapterCall, { callId, name, args });
    });
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Call right before loading a new URL so waitForReady waits for the fresh preload. */
  markNavigating(): void {
    this.ready = false;
  }

  waitForReady(timeoutMs = 15_000, signal?: AbortSignal): Promise<void> {
    if (this.ready) return Promise.resolve();
    if (signal?.aborted) return Promise.reject(new Error(CANCELLED));
    return new Promise((resolve, reject) => {
      const stop = (fn: () => void) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        this.readyWaiters = this.readyWaiters.filter((w) => w !== done);
        fn();
      };
      const timer = setTimeout(() => stop(() => reject(new Error('X view did not register tools in time'))), timeoutMs);
      const onAbort = () => stop(() => reject(new Error(CANCELLED)));
      const done = () => stop(resolve);
      signal?.addEventListener('abort', onAbort, { once: true });
      this.readyWaiters.push(done);
    });
  }

  /** The preload registers the same constants; a mismatch means the two halves shipped out of step. */
  private verify(registered: ToolSpec[]): void {
    const want = [...this.specs.map((t) => t.name)].sort().join(',');
    const got = [...registered.map((t) => t.name)].sort().join(',');
    if (want !== got) this.log(`[xpilot] adapter tools differ from the compiled specs: page has [${got}], main expects [${want}]`);
  }

  private rejectPending(message: string): void {
    for (const [callId, p] of [...this.pending]) {
      clearTimeout(p.timer);
      this.pending.delete(callId);
      p.resolve(fail(message));
    }
  }
}
