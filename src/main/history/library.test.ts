import { describe, it, expect } from 'vitest';
import { HistoryDb } from './db';
import { LibraryStore } from './library';

const library = () => new LibraryStore(new HistoryDb(':memory:').db);

describe('LibraryStore', () => {
  it('stores and lists library items', () => {
    const s = library();
    const item = s.add({ postId: null, url: 'https://x.com/a/status/1', path: '/tmp/a.pdf', title: 'A' });
    expect(item.id).toBe(1);
    expect(s.list()).toEqual([expect.objectContaining({ path: '/tmp/a.pdf', title: 'A' })]);
  });

  it('recognises recorded library paths regardless of the current folder', () => {
    const s = library();
    s.add({ postId: null, url: 'https://x.com/a/status/1', path: '/old/a.pdf', title: 'A' });
    expect(s.hasPath('/old/a.pdf')).toBe(true);
    expect(s.hasPath('/old/b.pdf')).toBe(false);
    expect(s.hasPath('/etc/passwd')).toBe(false);
  });
});
