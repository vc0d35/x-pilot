import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { registerHistoryIpc } from './ipc';
import { HistoryStore } from './store';
import { IPC } from '../../shared/ipc';

describe('registerHistoryIpc', () => {
  it('records valid liked/unliked payloads from the X view only', () => {
    const em = new EventEmitter();
    const store = new HistoryStore(':memory:');
    registerHistoryIpc({ ipc: { on: (ch, l) => { em.on(ch, l); } }, xContentsId: 1, store });
    const post = { id: '1', url: 'https://x.com/a/status/1', authorHandle: 'a', authorName: 'A', text: 'hello', postedAt: null, kind: 'post' };
    em.emit(IPC.historyLiked, { sender: { id: 2 } }, { post, likedAt: '2026-09-01T00:00:00Z' });
    expect(store.count()).toBe(0);
    em.emit(IPC.historyLiked, { sender: { id: 1 } }, { post, likedAt: '2026-09-01T00:00:00Z' });
    em.emit(IPC.historyLiked, { sender: { id: 1 } }, { garbage: true });
    expect(store.count()).toBe(1);
    em.emit(IPC.historyUnliked, { sender: { id: 1 } }, { id: '1', at: '2026-09-02T00:00:00Z' });
    expect(store.search({ query: 'hello' })[0].unlikedAt).toBe('2026-09-02T00:00:00Z');
  });
});
