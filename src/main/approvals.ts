import { randomUUID } from 'node:crypto';
import type { AgentEvent, ApprovalRequest } from '../shared/agent';

type Waiter = { resolve: (decision: string) => void; timer: NodeJS.Timeout };

export class ApprovalBroker {
  private readonly waiting = new Map<string, Waiter>();
  private readonly listeners = new Set<(e: AgentEvent) => void>();

  onEvent(cb: (e: AgentEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  request(req: Omit<ApprovalRequest, 'id'>, timeoutMs: number): Promise<string> {
    const id = randomUUID();
    const request: ApprovalRequest = { id, ...req };
    return new Promise<string>((resolve) => {
      const timer = setTimeout(() => this.finish(id, 'timeout'), timeoutMs);
      this.waiting.set(id, { resolve, timer });
      this.emit({ type: 'approval.requested', request });
    });
  }

  resolve(id: string, decision: string): boolean {
    if (!this.waiting.has(id)) return false;
    this.finish(id, decision);
    return true;
  }

  cancelAll(decision = 'cancel'): void {
    for (const id of [...this.waiting.keys()]) this.finish(id, decision);
  }

  private finish(id: string, decision: string): void {
    const w = this.waiting.get(id);
    if (!w) return;
    clearTimeout(w.timer);
    this.waiting.delete(id);
    w.resolve(decision);
    this.emit({ type: 'approval.resolved', id, decision });
  }

  private emit(e: AgentEvent): void { for (const cb of this.listeners) cb(e); }
}
