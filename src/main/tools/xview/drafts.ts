import { randomUUID } from 'node:crypto';
import type { ViewTarget } from './context';

export interface Draft {
  id: string;
  text: string;
  target: string;
  /** The window the composer holding this draft is open in; x_submit_post has to use the same one. */
  view: ViewTarget;
  createdAt: number;
}
export class DraftStore {
  private readonly drafts = new Map<string, Draft>();
  create(d: { text: string; target: string; view: ViewTarget }): Draft {
    const draft = { id: randomUUID(), createdAt: Date.now(), ...d };
    this.drafts.set(draft.id, draft);
    return draft;
  }
  get(id: string): Draft | undefined {
    return this.drafts.get(id);
  }
  delete(id: string): void {
    this.drafts.delete(id);
  }
}
