import { z } from 'zod';
import { fail, ToolResultSchema, type ToolResult, type ToolSpec } from '../../shared/tools';

const PageSpecSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
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

export function createPageToolHost(): PageToolHost {
  const specs = new Map<string, ToolSpec>();
  const pending = new Map<string, { resolve: (r: ToolResult) => void; timer: ReturnType<typeof setTimeout> }>();
  const listeners = new Set<() => void>();
  let onCallCb: ((callId: string, name: string, args: unknown) => void) | null = null;
  let seq = 0;
  const emit = () => { for (const cb of listeners) cb(); };

  return {
    bridgeApi: {
      registerTool(spec) {
        const parsed = PageSpecSchema.safeParse(spec);
        if (!parsed.success) return;
        specs.set(parsed.data.name, parsed.data as ToolSpec);
        emit();
      },
      unregisterTool(name) { if (specs.delete(name)) emit(); },
      onCall(cb) { onCallCb = cb; },
      respond(callId, result) {
        const p = pending.get(callId);
        if (!p) return;
        clearTimeout(p.timer);
        pending.delete(callId);
        const parsed = ToolResultSchema.safeParse(result);
        p.resolve(parsed.success ? parsed.data : fail(`Page tool returned a malformed result: ${callId.split(':')[0]}`));
      },
    },
    list: () => [...specs.values()],
    call(name, args, timeoutMs = 30_000) {
      if (!specs.has(name)) return Promise.resolve(fail(`Unknown page tool: ${name}`));
      if (!onCallCb) return Promise.resolve(fail('Page has not connected to the modelContext polyfill'));
      const callId = `${name}:${++seq}`;
      return new Promise<ToolResult>((resolve) => {
        const timer = setTimeout(() => { pending.delete(callId); resolve(fail(`Page tool timed out: ${name}`)); }, timeoutMs);
        pending.set(callId, { resolve, timer });
        onCallCb!(callId, name, args);
      });
    },
    onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
  };
}
