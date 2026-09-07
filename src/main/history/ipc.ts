import { z } from 'zod';
import { IPC } from '../../shared/ipc';
import { PostSchema } from '../../shared/page';
import type { BridgeIpc } from '../webmcp/bridge';
import type { HistoryStore } from './store';

const LikedSchema = z.object({ post: PostSchema, likedAt: z.string() });
const UnlikedSchema = z.object({ id: z.string(), at: z.string() });

export function registerHistoryIpc(deps: { ipc: BridgeIpc; xContentsId: number; store: HistoryStore }): void {
  deps.ipc.on(IPC.historyLiked, (event, payload) => {
    if (event.sender.id !== deps.xContentsId) return;
    const parsed = LikedSchema.safeParse(payload);
    if (parsed.success) deps.store.recordLike(parsed.data.post, parsed.data.likedAt);
  });
  deps.ipc.on(IPC.historyUnliked, (event, payload) => {
    if (event.sender.id !== deps.xContentsId) return;
    const parsed = UnlikedSchema.safeParse(payload);
    if (parsed.success) deps.store.recordUnlike(parsed.data.id, parsed.data.at);
  });
}
