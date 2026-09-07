import { randomUUID } from 'node:crypto';
export interface Draft { id: string; text: string; target: string; createdAt: number }
export class DraftStore {
  private readonly drafts = new Map<string, Draft>();
  create(d: { text: string; target: string }): Draft { const draft = { id: randomUUID(), createdAt: Date.now(), ...d }; this.drafts.set(draft.id, draft); return draft; }
  get(id: string): Draft | undefined { return this.drafts.get(id); }
  delete(id: string): void { this.drafts.delete(id); }
}
