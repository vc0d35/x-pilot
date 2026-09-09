import { randomUUID } from 'node:crypto';
import type { AgentEvent, UserInputAnswers, UserInputQuestion, UserInputRequest } from '../shared/agent';

type Waiter = { resolve: (answers: UserInputAnswers) => void; timer: NodeJS.Timeout };

/**
 * Clarifying questions from the agent, answered in the sidebar. Modelled on `ApprovalBroker`:
 * one pending request per id, and every outcome (answers, skip, timeout, cancellation) settles
 * the promise exactly once so a wedged UI can never leave the agent waiting forever.
 */
export class UserInputBroker {
  private readonly waiting = new Map<string, Waiter>();
  private readonly listeners = new Set<(e: AgentEvent) => void>();

  onEvent(cb: (e: AgentEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Resolves with the answers, or with null when the user skipped, the timeout expired, or the agent died. */
  request(req: { questions: UserInputQuestion[] }, timeoutMs: number): Promise<UserInputAnswers> {
    const id = randomUUID();
    const request: UserInputRequest = { id, questions: req.questions };
    return new Promise<UserInputAnswers>((resolve) => {
      const timer = setTimeout(() => this.finish(id, null), timeoutMs);
      this.waiting.set(id, { resolve, timer });
      this.emit({ type: 'input.requested', request });
    });
  }

  resolve(id: string, answers: Record<string, string>): boolean {
    if (!this.waiting.has(id)) return false;
    this.finish(id, answers);
    return true;
  }

  cancel(id: string): boolean {
    if (!this.waiting.has(id)) return false;
    this.finish(id, null);
    return true;
  }

  cancelAll(): void {
    for (const id of [...this.waiting.keys()]) this.finish(id, null);
  }

  private finish(id: string, answers: UserInputAnswers): void {
    const w = this.waiting.get(id);
    if (!w) return;
    clearTimeout(w.timer);
    this.waiting.delete(id);
    w.resolve(answers);
    this.emit({ type: 'input.resolved', id, answers });
  }

  private emit(e: AgentEvent): void {
    for (const cb of this.listeners) cb(e);
  }
}
