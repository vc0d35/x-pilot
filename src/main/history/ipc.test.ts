import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { registerHistoryIpc } from './ipc';
import { AppStore } from './store';
import { IPC } from '../../shared/ipc';

const post = (over: Record<string, unknown> = {}) => ({
  id: '1',
  url: 'https://x.com/a/status/1',
  authorHandle: 'a',
  authorName: 'A',
  text: 'hello',
  postedAt: null,
  kind: 'post',
  ...over,
});

function setup(opts: { now?: () => number } = {}) {
  const em = new EventEmitter();
  const store = new AppStore(':memory:');
  const warnings: string[] = [];
  const ipc = {
    on: (ch: string, l: (...a: never[]) => void) => {
      em.on(ch, l as (...a: unknown[]) => void);
    },
  };
  registerHistoryIpc({ ipc, xContentsId: 1, store, now: opts.now, warn: (m) => warnings.push(m) });
  return { em, store, warnings, ipc };
}

describe('registerHistoryIpc', () => {
  it('records valid liked/unliked payloads from the X view only', () => {
    const { em, store } = setup();
    em.emit(IPC.historyLiked, { sender: { id: 2 } }, { post: post(), likedAt: '2026-09-01T00:00:00Z' });
    expect(store.count()).toBe(0);
    em.emit(IPC.historyLiked, { sender: { id: 1 } }, { post: post(), likedAt: '2026-09-01T00:00:00Z' });
    em.emit(IPC.historyLiked, { sender: { id: 1 } }, { garbage: true });
    expect(store.count()).toBe(1);
    em.emit(IPC.historyUnliked, { sender: { id: 1 } }, { id: '1', at: '2026-09-02T00:00:00Z' });
    expect(store.search({ query: 'hello' })[0].unlikedAt).toBe('2026-09-02T00:00:00Z');
  });

  it('drops payloads that exceed the caps or are not x.com status posts', () => {
    const { em, store } = setup();
    const send = (p: Record<string, unknown>) =>
      em.emit(IPC.historyLiked, { sender: { id: 1 } }, { post: p, likedAt: '2026-09-01T00:00:00Z' });
    send(post({ text: 'x'.repeat(4001) }));
    send(post({ id: 'x'.repeat(33) }));
    send(post({ id: 'abc' }));
    send(post({ url: 'https://evil.com/a/status/1' }));
    send(post({ url: `https://x.com/a/status/1?${'x'.repeat(600)}` }));
    send(post({ authorHandle: 'h'.repeat(65) }));
    send(post({ authorName: 'n'.repeat(129) }));
    expect(store.count()).toBe(0);
    em.emit(IPC.historyUnliked, { sender: { id: 1 } }, { id: '../../etc', at: 'now' });
    send(post({ text: 'x'.repeat(4000) }));
    expect(store.count()).toBe(1);
  });

  it('accepts twitter.com status urls', () => {
    const { em, store } = setup();
    em.emit(
      IPC.historyLiked,
      { sender: { id: 1 } },
      { post: post({ url: 'https://twitter.com/a/status/1' }), likedAt: '2026-09-01T00:00:00Z' },
    );
    expect(store.count()).toBe(1);
  });

  it('rate-limits a sender to 10 events per 10 s and warns on the rest', () => {
    let clock = 0;
    const { em, store, warnings } = setup({ now: () => clock });
    for (let i = 0; i < 15; i++)
      em.emit(
        IPC.historyLiked,
        { sender: { id: 1 } },
        { post: post({ id: String(100 + i), url: `https://x.com/a/status/${100 + i}` }), likedAt: '2026-09-01T00:00:00Z' },
      );
    expect(store.count()).toBe(10);
    expect(warnings).toHaveLength(5);
    clock += 10_001;
    em.emit(
      IPC.historyLiked,
      { sender: { id: 1 } },
      { post: post({ id: '200', url: 'https://x.com/a/status/200' }), likedAt: '2026-09-01T00:00:00Z' },
    );
    expect(store.count()).toBe(11);
  });

  it('rate-limits per sender, not globally', () => {
    const clock = 0;
    const { em, store, ipc } = setup({ now: () => clock });
    registerHistoryIpc({ ipc, xContentsId: 2, store });
    for (let i = 0; i < 12; i++)
      em.emit(
        IPC.historyLiked,
        { sender: { id: 1 } },
        { post: post({ id: String(100 + i), url: `https://x.com/a/status/${100 + i}` }), likedAt: '2026-09-01T00:00:00Z' },
      );
    for (let i = 0; i < 3; i++)
      em.emit(
        IPC.historyLiked,
        { sender: { id: 2 } },
        { post: post({ id: String(300 + i), url: `https://x.com/a/status/${300 + i}` }), likedAt: '2026-09-01T00:00:00Z' },
      );
    expect(store.count()).toBe(13);
  });

  it('adds later X windows to one set of listeners instead of stacking new ones', () => {
    const { em, store, ipc } = setup();
    for (let id = 2; id <= 6; id++) registerHistoryIpc({ ipc, xContentsId: id, store });
    expect(em.listenerCount(IPC.historyLiked)).toBe(1);
    expect(em.listenerCount(IPC.historyUnliked)).toBe(1);
    em.emit(IPC.historyLiked, { sender: { id: 6 } }, { post: post(), likedAt: '2026-09-01T00:00:00Z' });
    expect(store.count()).toBe(1);
    em.emit(
      IPC.historyLiked,
      { sender: { id: 7 } },
      { post: post({ id: '2', url: 'https://x.com/a/status/2' }), likedAt: '2026-09-01T00:00:00Z' },
    );
    expect(store.count()).toBe(1);
  });
});
