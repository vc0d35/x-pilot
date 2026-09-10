import { randomUUID } from 'node:crypto';
import type { AgentEvent, ApprovalOrigin, ApprovalRequest } from '../shared/agent';

/** What the user chose, and what they typed if the option they picked asked for a note. */
export interface ApprovalDecision {
  decision: string;
  note?: string;
}

type Waiter = { resolve: (d: ApprovalDecision) => void; timer: NodeJS.Timeout };

export class ApprovalBroker {
  private readonly waiting = new Map<string, Waiter>();
  private readonly listeners = new Set<(e: AgentEvent) => void>();

  onEvent(cb: (e: AgentEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** `origin` defaults to the agent: only a caller that knows it is acting for something else sets it. */
  request(req: Omit<ApprovalRequest, 'id' | 'origin'> & { origin?: ApprovalOrigin }, timeoutMs: number): Promise<ApprovalDecision> {
    const id = randomUUID();
    const request: ApprovalRequest = { ...req, id, origin: req.origin ?? { kind: 'agent' } };
    return new Promise<ApprovalDecision>((resolve) => {
      const timer = setTimeout(() => this.finish(id, 'timeout'), timeoutMs);
      this.waiting.set(id, { resolve, timer });
      this.emit({ type: 'approval.requested', request });
    });
  }

  resolve(id: string, decision: string, note?: string): boolean {
    if (!this.waiting.has(id)) return false;
    this.finish(id, decision, note);
    return true;
  }

  /**
   * Settles every outstanding request rather than dropping it: a tool awaiting one has cleanup of
   * its own to run — a style preview to take back off — and a promise that never resolves would
   * leave the page wearing it.
   */
  cancelAll(decision = 'cancel'): void {
    for (const id of [...this.waiting.keys()]) this.finish(id, decision);
  }

  private finish(id: string, decision: string, note?: string): void {
    const w = this.waiting.get(id);
    if (!w) return;
    clearTimeout(w.timer);
    this.waiting.delete(id);
    w.resolve(note === undefined ? { decision } : { decision, note });
    this.emit(note === undefined ? { type: 'approval.resolved', id, decision } : { type: 'approval.resolved', id, decision, note });
  }

  private emit(e: AgentEvent): void {
    for (const cb of this.listeners) cb(e);
  }
}
