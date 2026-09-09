import { fail, type ToolModule, type ToolResult, type ToolSpec } from '../../shared/tools';

export interface ToolSource {
  id: string;
  list(): ToolSpec[];
  call(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult>;
  onChange?(cb: () => void): () => void;
}

export class AppToolSource<Ctx> implements ToolSource {
  private readonly byName = new Map<string, ToolModule<Ctx>>();
  constructor(public readonly id: string, modules: ToolModule<Ctx>[], private readonly ctx: Ctx) {
    for (const m of modules) this.byName.set(m.spec.name, m);
  }
  list(): ToolSpec[] { return [...this.byName.values()].map((m) => m.spec); }
  async call(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
    const m = this.byName.get(name);
    if (!m) return fail(`Unknown tool: ${name}`);
    return m.execute(args, this.ctx, signal);
  }
}

export class ToolRegistry {
  private readonly sources: ToolSource[] = [];
  private readonly unsubscribers = new Map<ToolSource, () => void>();
  private readonly listeners = new Set<() => void>();

  addSource(src: ToolSource): () => void {
    this.sources.push(src);
    if (src.onChange) this.unsubscribers.set(src, src.onChange(() => this.emit()));
    this.emit();
    return () => {
      const i = this.sources.indexOf(src);
      if (i >= 0) this.sources.splice(i, 1);
      this.unsubscribers.get(src)?.();
      this.unsubscribers.delete(src);
      this.emit();
    };
  }

  /** Later sources win on name collisions. Internal tools are hidden unless `includeInternal` is set. */
  list(opts?: { includeInternal?: boolean }): ToolSpec[] {
    const byName = new Map<string, ToolSpec>();
    for (const src of this.sources) for (const spec of src.list()) byName.set(spec.name, spec);
    const specs = [...byName.values()];
    return opts?.includeInternal ? specs : specs.filter((s) => !s.annotations?.internal);
  }

  /** True even for internal tools: `has` reflects registration, not callability. */
  has(name: string): boolean { return this.resolve(name) !== undefined; }

  async call(name: string, args: Record<string, unknown>, opts?: { allowInternal?: boolean; signal?: AbortSignal }): Promise<ToolResult> {
    const src = this.resolve(name);
    if (!src) return fail(`Unknown tool: ${name}`);
    const spec = src.list().find((s) => s.name === name);
    if (spec?.annotations?.internal && !opts?.allowInternal) return fail(`Tool is internal: ${name}`);
    try {
      return await src.call(name, args, opts?.signal);
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private resolve(name: string): ToolSource | undefined {
    for (let i = this.sources.length - 1; i >= 0; i--) {
      if (this.sources[i].list().some((t) => t.name === name)) return this.sources[i];
    }
    return undefined;
  }

  private emit() { for (const cb of this.listeners) cb(); }
}
