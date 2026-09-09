import { describe, it, expect, vi } from 'vitest';
import { searchHistory } from './search-history';
import { fail, runTool } from '../../../shared/tools';
import { AppStore, toFtsQuery, type HistoryHit, type HistoryQuery } from '../../history/store';
import type { AppToolCtx } from './context';

function ctx() {
  const search = vi.fn((_q: HistoryQuery): HistoryHit[] => []);
  const store = { search, count: () => 0 } as unknown as AppToolCtx['store'];
  return { c: { store } as AppToolCtx, search };
}

const args = (over: Record<string, unknown>) => ({ query: 'hello', ...over });
const run = (c: AppToolCtx, over: Record<string, unknown> = {}) => runTool(searchHistory, args(over), c);

describe('xpilot_search_history', () => {
  it('defaults the limit and refuses one outside the range it declares', async () => {
    const { c, search } = ctx();
    await run(c);
    expect(search.mock.calls[0][0]).toMatchObject({ limit: 20 });
    expect(await run(c, { limit: 1e9 })).toEqual(
      fail('Invalid arguments for xpilot_search_history: limit: Too big: expected number to be <=100'),
    );
    expect(await run(c, { limit: 0 })).toMatchObject({ success: false });
    expect(await run(c, { limit: 'lots' })).toMatchObject({ success: false });
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('truncates a long query rather than failing on it', async () => {
    const { c, search } = ctx();
    const r = await run(c, { query: 'a '.repeat(5000) });
    expect(r.success).toBe(true);
    expect(search.mock.calls[0][0].query).toHaveLength(200);
  });

  it('still requires something to search for', async () => {
    expect(await run(ctx().c, { query: '   ' })).toMatchObject({ success: false });
  });
});

describe('toFtsQuery', () => {
  it('caps the number of prefix terms', () => {
    expect(toFtsQuery('a '.repeat(1000)).split(' ')).toHaveLength(32);
    expect(toFtsQuery('hello world')).toBe('"hello"* "world"*');
  });

  it('answers a query of ten thousand matching tokens quickly', () => {
    const store = new AppStore(':memory:');
    for (let i = 0; i < 50; i++) {
      store.recordLike({
        id: String(i),
        url: `https://x.com/a/status/${i}`,
        authorHandle: 'a',
        authorName: 'A',
        text: 'a a a hello world lorem ipsum',
        postedAt: null,
        kind: 'post',
      });
    }
    const started = Date.now();
    store.search({ query: 'a '.repeat(10_000), limit: 20 });
    expect(Date.now() - started).toBeLessThan(500);
  });
});
