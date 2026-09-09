import { z } from 'zod';
import { IPC } from '../../shared/ipc';
import { PostSchema } from '../../shared/page';
import type { BridgeIpc } from '../adapter/bridge';
import type { AppStore } from './store';

const POST_ID = /^\d{1,32}$/;
const STATUS_URL = /^https:\/\/(?:x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/\d{1,32}$/;

/** Tighter than PostSchema: this payload comes from the page and is persisted as the user's own history. */
const LikedPostSchema = PostSchema.extend({
  id: z.string().regex(POST_ID),
  url: z.string().max(512).regex(STATUS_URL),
  authorHandle: z.string().max(64),
  authorName: z.string().max(128),
  text: z.string().max(4000),
});

const LikedSchema = z.object({ post: LikedPostSchema, likedAt: z.string().max(64) });
const UnlikedSchema = z.object({ id: z.string().regex(POST_ID), at: z.string().max(64) });

const RATE = { max: 10, windowMs: 10_000 };

interface Registration {
  /** Sender ids allowed to write, and the store each writes to; X windows are recreated, listeners are not. */
  senders: Map<number, AppStore>;
  hits: Map<number, number[]>;
  now: () => number;
  warn: (message: string) => void;
}

const registrations = new WeakMap<BridgeIpc, Registration>();

function allow(reg: Registration, senderId: number): boolean {
  const t = reg.now();
  const times = (reg.hits.get(senderId) ?? []).filter((x) => t - x < RATE.windowMs);
  if (times.length >= RATE.max) {
    reg.hits.set(senderId, times);
    reg.warn(`[xpilot] dropped a liked-post event: more than ${RATE.max} in ${RATE.windowMs} ms from sender ${senderId}`);
    return false;
  }
  times.push(t);
  reg.hits.set(senderId, times);
  return true;
}

export function registerHistoryIpc(deps: {
  ipc: BridgeIpc;
  xContentsId: number;
  store: AppStore;
  now?: () => number;
  warn?: (message: string) => void;
}): void {
  let reg = registrations.get(deps.ipc);
  if (!reg) {
    reg = { senders: new Map(), hits: new Map(), now: deps.now ?? Date.now, warn: deps.warn ?? ((m) => console.warn(m)) };
    registrations.set(deps.ipc, reg);
    const accept = (event: { sender: { id: number } }): AppStore | null => {
      const store = reg!.senders.get(event.sender.id);
      if (!store) return null;
      return allow(reg!, event.sender.id) ? store : null;
    };
    deps.ipc.on(IPC.historyLiked, (event, payload) => {
      const store = accept(event);
      if (!store) return;
      const parsed = LikedSchema.safeParse(payload);
      if (parsed.success) store.recordLike(parsed.data.post, parsed.data.likedAt);
    });
    deps.ipc.on(IPC.historyUnliked, (event, payload) => {
      const store = accept(event);
      if (!store) return;
      const parsed = UnlikedSchema.safeParse(payload);
      if (parsed.success) store.recordUnlike(parsed.data.id, parsed.data.at);
    });
  }
  reg.senders.set(deps.xContentsId, deps.store);
}
