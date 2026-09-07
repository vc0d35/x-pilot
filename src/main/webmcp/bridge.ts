import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { IPC } from '../../shared/ipc';
import { fail, ToolResultSchema, ToolSpecSchema, type ToolResult, type ToolSpec } from '../../shared/tools';
import type { ToolSource } from '../tools/registry';

export interface BridgeIpc { on(channel: string, listener: (event: { sender: { id: number } }, payload: unknown) => void): void }
export interface BridgeTarget { id: number; send(channel: string, payload: unknown): void }

const RegisterSchema = z.object({ tools: z.array(ToolSpecSchema) });
const ResultSchema = z.object({ callId: z.string(), result: ToolResultSchema });

export class WebMcpBridge implements ToolSource {
  readonly id = 'webmcp';
  private tools: ToolSpec[] = [];
  private readonly pending = new Map<string, { resolve: (r: ToolResult) => void; timer: NodeJS.Timeout }>();
  private readonly listeners = new Set<() => void>();
  private readyWaiters: Array<() => void> = [];

  constructor(ipc: BridgeIpc, private readonly target: BridgeTarget, private readonly timeoutMs = 60_000) {
    ipc.on(IPC.webmcpRegister, (event, payload) => {
      if (event.sender.id !== target.id) return;
      const parsed = RegisterSchema.safeParse(payload);
      if (!parsed.success) return;
      this.tools = parsed.data.tools;
      for (const cb of this.listeners) cb();
      for (const w of this.readyWaiters.splice(0)) w();
    });
    ipc.on(IPC.webmcpResult, (event, payload) => {
      if (event.sender.id !== target.id) return;
      const parsed = ResultSchema.safeParse(payload);
      if (!parsed.success) return;
      const p = this.pending.get(parsed.data.callId);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(parsed.data.callId);
      p.resolve(parsed.data.result);
    });
  }

  list(): ToolSpec[] { return this.tools; }

  call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (!this.tools.some((t) => t.name === name)) return Promise.resolve(fail(`Unknown tool: ${name}`));
    const callId = randomUUID();
    return new Promise<ToolResult>((resolve) => {
      const timer = setTimeout(() => { this.pending.delete(callId); resolve(fail(`Page tool call timed out: ${name}`)); }, this.timeoutMs);
      this.pending.set(callId, { resolve, timer });
      this.target.send(IPC.webmcpCall, { callId, name, args });
    });
  }

  onChange(cb: () => void): () => void { this.listeners.add(cb); return () => this.listeners.delete(cb); }

  /** Call right before loading a new URL so waitForReady waits for the fresh preload. */
  markNavigating(): void { this.tools = []; }

  waitForReady(timeoutMs = 15_000): Promise<void> {
    if (this.tools.length > 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.readyWaiters = this.readyWaiters.filter((w) => w !== done);
        reject(new Error('X view did not register tools in time'));
      }, timeoutMs);
      const done = () => { clearTimeout(timer); resolve(); };
      this.readyWaiters.push(done);
    });
  }
}
