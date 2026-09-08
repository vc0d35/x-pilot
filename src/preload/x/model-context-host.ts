import { z } from 'zod';
import { fail, ToolResultSchema, type ToolResult, type ToolSpec } from '../../shared/tools';

const PageSpecSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/, 'name must be 1-64 characters of a-z, A-Z, 0-9, _ or -'),
  description: z.string().min(1).max(500, 'description must be at most 500 characters'),
  inputSchema: z.record(z.string(), z.unknown()).default({ type: 'object', properties: {} }),
  annotations: z.record(z.string(), z.unknown()).optional(),
});

export interface PageToolHost {
  bridgeApi: {
    registerTool(spec: unknown): void;
    unregisterTool(name: string): void;
    onCall(cb: (callId: string, name: string, args: unknown) => void): void;
    respond(callId: string, result: unknown): void;
  };
  list(): ToolSpec[];
  call(name: string, args: Record<string, unknown>, timeoutMs?: number): Promise<ToolResult>;
  onChange(cb: () => void): () => void;
}

function newCallId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createPageToolHost(): PageToolHost {
  const specs = new Map<string, ToolSpec>();
  const pending = new Map<string, { name: string; resolve: (r: ToolResult) => void; timer: ReturnType<typeof setTimeout> }>();
  const listeners = new Set<() => void>();
  let onCallCb: ((callId: string, name: string, args: unknown) => void) | null = null;
  const emit = () => { for (const cb of listeners) cb(); };

  return {
    bridgeApi: {
      registerTool(spec) {
        const parsed = PageSpecSchema.safeParse(spec);
        if (!parsed.success) throw new TypeError(`Rejected tool registration: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'spec'}: ${i.message}`).join('; ')}`);
        specs.set(parsed.data.name, parsed.data as ToolSpec);
        emit();
      },
      unregisterTool(name) { if (specs.delete(name)) emit(); },
      onCall(cb) {
        // First-writer-wins: the main-world modelContext polyfill registers this once, on load.
        // Ignoring later registrations stops another main-world script from hijacking or
        // forging responses for in-flight and future page-tool calls.
        if (onCallCb) { console.warn('[xpilot] modelContext bridge already connected'); return; }
        onCallCb = cb;
      },
      respond(callId, result) {
        const p = pending.get(callId);
        if (!p) return;
        clearTimeout(p.timer);
        pending.delete(callId);
        const parsed = ToolResultSchema.safeParse(result);
        p.resolve(parsed.success ? parsed.data : fail(`Page tool returned a malformed result: ${p.name}`));
      },
    },
    list: () => [...specs.values()],
    call(name, args, timeoutMs = 30_000) {
      if (!specs.has(name)) return Promise.resolve(fail(`Unknown page tool: ${name}`));
      if (!onCallCb) return Promise.resolve(fail('Page has not connected to the modelContext polyfill'));
      const callId = newCallId();
      return new Promise<ToolResult>((resolve) => {
        const timer = setTimeout(() => { pending.delete(callId); resolve(fail(`Page tool timed out: ${name}`)); }, timeoutMs);
        pending.set(callId, { name, resolve, timer });
        onCallCb!(callId, name, args);
      });
    },
    onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
  };
}
