import { describe, it, expect } from 'vitest';
import { HistoryStore } from './store';
import type { Post } from '../../shared/page';

const post = (id: string, text: string, handle = 'alice', extra: Partial<Post> = {}): Post => ({
  id, url: `https://x.com/${handle}/status/${id}`, authorHandle: handle, authorName: handle.toUpperCase(), text, postedAt: null, kind: 'post', ...extra,
});

describe('HistoryStore', () => {
  it('records likes and finds them by text and author', () => {
    const s = new HistoryStore(':memory:');
    s.recordLike(post('1', 'Rust borrow checker tips'), '2026-09-01T00:00:00Z');
    s.recordLike(post('2', 'Electron WebContentsView guide', 'bob'), '2026-09-02T00:00:00Z');
    s.recordLike(post('3', 'More rust: lifetimes', 'bob'), '2026-09-03T00:00:00Z');
    expect(s.search({ query: 'rust' }).map((h) => h.id).sort()).toEqual(['1', '3']);
    expect(s.search({ query: 'rust', author: 'bob' }).map((h) => h.id)).toEqual(['3']);
    expect(s.search({ query: 'rust', since: '2026-09-02T00:00:00Z' }).map((h) => h.id)).toEqual(['3']);
    expect(s.search({ query: 'electr' })[0].snippet).toContain('[Electron]');
    expect(s.count()).toBe(3);
  });

  it('keeps unliked posts but flags them; re-liking clears the flag', () => {
    const s = new HistoryStore(':memory:');
    s.recordLike(post('1', 'hello world'), '2026-09-01T00:00:00Z');
    s.recordUnlike('1', '2026-09-02T00:00:00Z');
    expect(s.search({ query: 'hello' })[0].unlikedAt).toBe('2026-09-02T00:00:00Z');
    s.recordLike(post('1', 'hello world'), '2026-09-03T00:00:00Z');
    expect(s.search({ query: 'hello' })[0].unlikedAt).toBeNull();
  });

  it('indexes article title and body', () => {
    const s = new HistoryStore(':memory:');
    s.recordLike(post('9', 'short teaser', 'alice', { kind: 'article', articleTitle: 'On Compilers', articleBody: 'A long essay about parsing.' }));
    const hits = s.search({ query: 'parsing' });
    expect(hits.map((h) => h.id)).toEqual(['9']);
    expect(hits[0].snippet).toContain('[parsing]');
  });

  it('survives FTS special characters in queries and clears', () => {
    const s = new HistoryStore(':memory:');
    s.recordLike(post('1', 'what is "webmcp" (really)?'));
    expect(s.search({ query: 'webmcp (really)?' }).map((h) => h.id)).toEqual(['1']);
    expect(s.search({ query: '' })).toEqual([]);
    s.clear();
    expect(s.count()).toBe(0);
  });

  it('stores and lists library items', () => {
    const s = new HistoryStore(':memory:');
    const item = s.addLibraryItem({ postId: null, url: 'https://x.com/a/status/1', path: '/tmp/a.pdf', title: 'A' });
    expect(item.id).toBe(1);
    expect(s.listLibrary()).toEqual([expect.objectContaining({ path: '/tmp/a.pdf', title: 'A' })]);
    s.clear();
    expect(s.listLibrary()).toHaveLength(1); // clear() keeps the library
  });

  it('recognises recorded library paths regardless of the current folder', () => {
    const s = new HistoryStore(':memory:');
    s.addLibraryItem({ postId: null, url: 'https://x.com/a/status/1', path: '/old/a.pdf', title: 'A' });
    expect(s.hasLibraryPath('/old/a.pdf')).toBe(true);
    expect(s.hasLibraryPath('/old/b.pdf')).toBe(false);
    expect(s.hasLibraryPath('/etc/passwd')).toBe(false);
  });
});
