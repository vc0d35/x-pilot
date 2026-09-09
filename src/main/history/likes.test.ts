import { describe, it, expect } from 'vitest';
import { HistoryDb } from './db';
import { LikesStore } from './likes';
import type { Post } from '../../shared/page';

const post = (id: string, text: string, handle = 'alice', extra: Partial<Post> = {}): Post => ({
  id,
  url: `https://x.com/${handle}/status/${id}`,
  authorHandle: handle,
  authorName: handle.toUpperCase(),
  text,
  postedAt: null,
  kind: 'post',
  ...extra,
});

const likes = () => new LikesStore(new HistoryDb(':memory:').db);

describe('LikesStore', () => {
  it('records likes and finds them by text and author', () => {
    const s = likes();
    s.recordLike(post('1', 'Rust borrow checker tips'), '2026-09-01T00:00:00Z');
    s.recordLike(post('2', 'Electron WebContentsView guide', 'bob'), '2026-09-02T00:00:00Z');
    s.recordLike(post('3', 'More rust: lifetimes', 'bob'), '2026-09-03T00:00:00Z');
    expect(
      s
        .search({ query: 'rust' })
        .map((h) => h.id)
        .sort(),
    ).toEqual(['1', '3']);
    expect(s.search({ query: 'rust', author: 'bob' }).map((h) => h.id)).toEqual(['3']);
    expect(s.search({ query: 'rust', since: '2026-09-02T00:00:00Z' }).map((h) => h.id)).toEqual(['3']);
    expect(s.search({ query: 'electr' })[0].snippet).toContain('[Electron]');
    expect(s.count()).toBe(3);
  });

  it('keeps unliked posts but flags them; re-liking clears the flag', () => {
    const s = likes();
    s.recordLike(post('1', 'hello world'), '2026-09-01T00:00:00Z');
    s.recordUnlike('1', '2026-09-02T00:00:00Z');
    expect(s.search({ query: 'hello' })[0].unlikedAt).toBe('2026-09-02T00:00:00Z');
    s.recordLike(post('1', 'hello world'), '2026-09-03T00:00:00Z');
    expect(s.search({ query: 'hello' })[0].unlikedAt).toBeNull();
  });

  it('indexes article title and body', () => {
    const s = likes();
    s.recordLike(
      post('9', 'short teaser', 'alice', { kind: 'article', articleTitle: 'On Compilers', articleBody: 'A long essay about parsing.' }),
    );
    const hits = s.search({ query: 'parsing' });
    expect(hits.map((h) => h.id)).toEqual(['9']);
    expect(hits[0].snippet).toContain('[parsing]');
  });

  it('survives FTS special characters in queries and clears', () => {
    const s = likes();
    s.recordLike(post('1', 'what is "sqlite" (really)?'));
    expect(s.search({ query: 'sqlite (really)?' }).map((h) => h.id)).toEqual(['1']);
    expect(s.search({ query: '' })).toEqual([]);
    s.clear();
    expect(s.count()).toBe(0);
  });
});
