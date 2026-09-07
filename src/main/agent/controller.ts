import type { AgentEvent } from '../../shared/agent';
import type { PageContext } from '../../shared/page';
import type { SettingsStore } from '../settings';
import type { ToolRegistry } from '../tools/registry';
import type { AgentProvider, ModelInfo } from './provider';

export interface AgentControllerDeps {
  registry: ToolRegistry;
  settings: SettingsStore;
  workspaceDir: string;
  createProvider: () => AgentProvider;
}

export class AgentController {
  private provider: AgentProvider | null = null;
  private unsubscribe: (() => void) | null = null;
  private readonly listeners = new Set<(e: AgentEvent) => void>();

  constructor(private readonly deps: AgentControllerDeps) {}

  onEvent(cb: (e: AgentEvent) => void): () => void { this.listeners.add(cb); return () => this.listeners.delete(cb); }

  async start(opts: { resume: boolean }): Promise<void> {
    await this.stop();
    if (!opts.resume) this.deps.settings.update({ threadId: null });
    const provider = this.deps.createProvider();
    this.unsubscribe = provider.onEvent((e) => this.emit(e));
    this.provider = provider;
    try {
      const { threadId } = await provider.start({
        tools: this.deps.registry.list(),
        settings: this.deps.settings.get().agent.codex,
        threadId: opts.resume ? this.deps.settings.get().threadId : null,
        workspaceDir: this.deps.workspaceDir,
      });
      this.deps.settings.update({ threadId });
    } catch (err) {
      this.emit({ type: 'status', status: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  async send(text: string, ctx: PageContext | null): Promise<void> {
    if (!this.provider) throw new Error('Agent is not running');
    await this.provider.send(text, ctx);
  }

  async interrupt(): Promise<void> { await this.provider?.interrupt(); }
  async listModels(): Promise<ModelInfo[]> { return this.provider?.listModels() ?? []; }

  async stop(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    await this.provider?.stop();
    this.provider = null;
  }

  private emit(e: AgentEvent): void { for (const cb of this.listeners) cb(e); }
}
