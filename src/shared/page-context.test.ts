import { describe, it, expect } from 'vitest';
import { contextKey } from './page-context';
import type { PageContext } from './page';

const post = { id: '1', url: 'https://x.com/a/status/1', authorHandle: 'a', authorName: 'A', text: 'hello', postedAt: null, kind: 'post' as const };

describe('contextKey', () => {
  it('is null without a context', () => {
    expect(contextKey(null)).toBeNull();
    expect(contextKey(undefined)).toBeNull();
  });

  it('identifies a focused post by its id, whatever else changed', () => {
    const a: PageContext = { url: 'https://x.com/a/status/1', kind: 'post', post };
    const b: PageContext = { url: 'https://x.com/a/status/1?x=1', kind: 'post', post: { ...post, text: 'edited' } };
    expect(contextKey(a)).toBe('post:1');
    expect(contextKey(a)).toBe(contextKey(b));
  });

  it('identifies a timeline by the ordered ids on screen', () => {
    const visible = [{ id: '1', url: 'u1', authorHandle: 'a', text: 't1' }, { id: '2', url: 'u2', authorHandle: 'b', text: 't2' }];
    const tl: PageContext = { url: 'https://x.com/home', kind: 'home', post: null, visible };
    expect(contextKey(tl)).toBe('visible:1,2');
    expect(contextKey({ ...tl, visible: [visible[1], visible[0]] })).toBe('visible:2,1');
    expect(contextKey({ ...tl, visible: [] })).toBe('visible:');
    expect(contextKey({ url: 'https://x.com/home', kind: 'home', post: null })).toBe('visible:');
  });
});
