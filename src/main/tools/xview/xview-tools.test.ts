import { describe, it, expect, vi } from 'vitest';
import { navigate } from './navigate';
import { search } from './search';
import { readPost, normalizePostUrl } from './read-post';
import { ok, fail } from '../../../shared/tools';
import { DEFAULT_ALLOW_HOSTS } from '../../../shared/settings';

function ctx(current = 'https://x.com/home') {
  const state = { url: current };
  const xview = {
    currentUrl: () => state.url,
    navigate: vi.fn(async (u: string) => { state.url = u; }),
    callPreload: vi.fn(async (name: string) => name === 'x_get_page_state' ? ok({ url: state.url, kind: 'post', title: 't', adapterHealthy: true }) : ok({ post: { id: '1' }, thread: [], article: null })),
  };
  return { xview, allowHosts: () => DEFAULT_ALLOW_HOSTS };
}

describe('normalizePostUrl', () => {
  it('canonicalises status and article urls', () => {
    expect(normalizePostUrl('https://twitter.com/alice/status/111?s=20')).toBe('https://x.com/alice/status/111');
    expect(normalizePostUrl('https://x.com/i/article/9#top')).toBe('https://x.com/i/article/9');
    expect(normalizePostUrl('https://example.com/alice/status/111')).toBeNull();
    expect(normalizePostUrl('https://x.com/alice')).toBeNull();
  });
});

describe('x_navigate', () => {
  it('navigates within the allowlist and returns page state', async () => {
    const c = ctx();
    const r = await navigate.execute({ url: 'https://x.com/explore' }, c);
    expect(c.xview.navigate).toHaveBeenCalledWith('https://x.com/explore');
    expect(r).toEqual(ok({ url: 'https://x.com/explore', kind: 'post', title: 't', adapterHealthy: true }));
  });
  it('refuses off-allowlist urls', async () => {
    const c = ctx();
    expect(await navigate.execute({ url: 'https://example.com' }, c)).toEqual(fail('Refusing to navigate outside x.com: https://example.com'));
    expect(c.xview.navigate).not.toHaveBeenCalled();
  });
});

describe('x_search', () => {
  it('opens the search page and reads results', async () => {
    const c = ctx();
    await search.execute({ query: 'rust lang' }, c);
    expect(c.xview.navigate).toHaveBeenCalledWith('https://x.com/search?q=rust%20lang&src=typed_query&f=top');
    expect(c.xview.callPreload).toHaveBeenCalledWith('x_read_visible_posts', { limit: 20 });
  });
});

describe('x_read_post', () => {
  it('navigates only when the page differs, then reads', async () => {
    const c = ctx('https://x.com/alice/status/111');
    await readPost.execute({ url: 'https://x.com/alice/status/111?s=1' }, c);
    expect(c.xview.navigate).not.toHaveBeenCalled();
    await readPost.execute({ url: 'https://x.com/bob/status/2' }, c);
    expect(c.xview.navigate).toHaveBeenCalledWith('https://x.com/bob/status/2');
    expect(c.xview.callPreload).toHaveBeenLastCalledWith('x_read_current_post', {});
  });
  it('rejects non-post urls', async () => {
    expect(await readPost.execute({ url: 'https://x.com/alice' }, ctx())).toEqual(fail('Not a post or article URL: https://x.com/alice'));
  });
});
