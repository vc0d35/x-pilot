import { describe, it, expect, vi } from 'vitest';
import { searchHistory } from './search-history';
import { HistoryStore, toFtsQuery, type HistoryHit, type HistoryQuery } from '../../history/store';
import type { AppToolCtx } from './context';

function ctx() {
  const search = vi.fn((_q: HistoryQuery): HistoryHit[] => []);
  const history = { search, count: () => 0 } as unknown as AppToolCtx['history'];
  return { c: { history } as AppToolCtx, search };
}

const args = (over: Record<string, unknown>) => ({ query: 'hello', ...over });

describe('xpilot_search_history', () => {
  it('clamps the limit to the maximum it declares', async () => {
    const { c, search } = ctx();
    await searchHistory.execute(args({ limit: 1e9 }), c);
    expect(search.mock.calls[0][0]).toMatchObject({ limit: 100 });
    await searchHistory.execute(args({ limit: 0 }), c);
    expect(search.mock.calls[1][0]).toMatchObject({ limit: 1 });
    await searchHistory.execute(args({}), c);
    expect(search.mock.calls[2][0]).toMatchObject({ limit: 20 });
    await searchHistory.execute(args({ limit: 'lots' }), c);
    expect(search.mock.calls[3][0]).toMatchObject({ limit: 20 });
  });

  it('truncates a long query rather than failing on it', async () => {
    const { c, search } = ctx();
    const r = await searchHistory.execute(args({ query: 'a '.repeat(5000) }), c);
    expect(r.success).toBe(true);
    expect(search.mock.calls[0][0].query).toHaveLength(200);
  });

  it('still requires something to search for', async () => {
    expect(await searchHistory.execute({ query: '   ' }, ctx().c)).toMatchObject({ success: false });
  });
});

describe('toFtsQuery', () => {
  it('caps the number of prefix terms', () => {
    expect(toFtsQuery('a '.repeat(1000)).split(' ')).toHaveLength(32);
    expect(toFtsQuery('hello world')).toBe('"hello"* "world"*');
  });

  it('answers a query of ten thousand matching tokens quickly', () => {
    const store = new HistoryStore(':memory:');
    for (let i = 0; i < 50; i++) {
      store.recordLike({ id: String(i), url: `https://x.com/a/status/${i}`, authorHandle: 'a', authorName: 'A', text: 'a a a hello world lorem ipsum', postedAt: null, kind: 'post' });
    }
    const started = Date.now();
    store.search({ query: 'a '.repeat(10_000), limit: 20 });
    expect(Date.now() - started).toBeLessThan(500);
  });
});
