import { describe, it, expect, vi } from 'vitest';
import { navigate } from './navigate';
import { search } from './search';
import { readPost, normalizePostUrl } from './read-post';
import { ok, fail } from '../../../shared/tools';
import { DEFAULT_ALLOW_HOSTS } from '../../../shared/settings';
import { ApprovalBroker } from '../../approvals';
import { DraftStore } from './drafts';

function fakeView(current: string) {
  const state = { url: current };
  return {
    currentUrl: () => state.url,
    navigate: vi.fn(async (u: string) => {
      state.url = u;
    }),
    callPreload: vi.fn(async (name: string) =>
      name === 'x_get_page_state'
        ? ok({ url: state.url, kind: 'post', title: 't', adapterHealthy: true })
        : name === 'x_read_visible_posts'
          ? ok([{ id: 'r1' }])
          : ok({ post: { id: '1' }, thread: [], article: null }),
    ),
  };
}

function ctx(current = 'https://x.com/home') {
  const state = { url: current };
  const xview = {
    currentUrl: () => state.url,
    navigate: vi.fn(async (u: string) => {
      state.url = u;
    }),
    callPreload: vi.fn(async (name: string) =>
      name === 'x_get_page_state'
        ? ok({ url: state.url, kind: 'post', title: 't', adapterHealthy: true })
        : ok({ post: { id: '1' }, thread: [], article: null }),
    ),
  };
  const bg = fakeView('about:blank');
  return {
    xview,
    bg,
    background: async () => bg,
    allowHosts: () => DEFAULT_ALLOW_HOSTS,
    approvals: new ApprovalBroker(),
    postingMode: () => 'confirm' as const,
    likesMode: () => 'auto' as const,
    bookmarksMode: () => 'auto' as const,
    likes: { recordLike: vi.fn(), recordUnlike: vi.fn() },
    drafts: new DraftStore(),
  };
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
    expect(c.xview.navigate).toHaveBeenCalledWith('https://x.com/explore', undefined);
    expect(r).toEqual(ok({ url: 'https://x.com/explore', kind: 'post', title: 't', adapterHealthy: true }));
  });
  it('refuses off-allowlist urls', async () => {
    const c = ctx();
    expect(await navigate.execute({ url: 'https://example.com' }, c)).toEqual(
      fail('Refusing to navigate outside x.com: https://example.com'),
    );
    expect(c.xview.navigate).not.toHaveBeenCalled();
  });
  it('refuses x.com paths that act on the account or the session', async () => {
    const c = ctx();
    for (const url of [
      'https://x.com/logout',
      'https://x.com/settings',
      'https://x.com/settings/deactivate',
      'https://x.com/i/flow/login',
      'https://x.com/intent/follow?screen_name=evil',
      'https://x.com/compose/post',
      'https://x.com/account/switch',
      'https://x.com/SETTINGS/x',
    ]) {
      const r = await navigate.execute({ url }, c);
      expect(r.success, url).toBe(false);
    }
    expect(c.xview.navigate).not.toHaveBeenCalled();
    expect(await navigate.execute({ url: 'https://x.com/alice/status/1' }, c)).toMatchObject({ success: true });
    expect(c.xview.navigate).toHaveBeenCalledWith('https://x.com/alice/status/1', undefined);
  });
});

describe('x_search', () => {
  it('opens the search page and reads results', async () => {
    const c = ctx();
    await search.execute({ query: 'rust lang' }, c);
    expect(c.bg.navigate).toHaveBeenCalledWith('https://x.com/search?q=rust%20lang&src=typed_query&f=top', undefined);
    expect(c.bg.callPreload).toHaveBeenCalledWith('x_read_visible_posts', { limit: 20 }, undefined);
  });
});

describe('x_read_post', () => {
  it('reads in the background even when the visible window claims to be on that post', async () => {
    const c = ctx('https://x.com/alice/status/111');
    await readPost.execute({ url: 'https://x.com/alice/status/111?s=1' }, c);
    expect(c.xview.navigate).not.toHaveBeenCalled();
    expect(c.xview.callPreload).not.toHaveBeenCalled();
    expect(c.bg.navigate).toHaveBeenCalledWith('https://x.com/alice/status/111', undefined);
    await readPost.execute({ url: 'https://x.com/bob/status/2' }, c);
    expect(c.bg.navigate).toHaveBeenCalledWith('https://x.com/bob/status/2', undefined);
    expect(c.bg.callPreload).toHaveBeenLastCalledWith('x_read_current_post', {}, undefined);
    expect(c.xview.navigate).not.toHaveBeenCalled();
  });
  it('rejects non-post urls', async () => {
    expect(await readPost.execute({ url: 'https://x.com/alice' }, ctx())).toEqual(fail('Not a post or article URL: https://x.com/alice'));
  });
});

describe('background vs visible routing', () => {
  it('x_search runs in the background window by default and in the visible one on request', async () => {
    const c = ctx();
    const r = await search.execute({ query: 'dhh' }, c);
    expect(c.bg.navigate).toHaveBeenCalledWith('https://x.com/search?q=dhh&src=typed_query&f=top', undefined);
    expect(c.xview.navigate).not.toHaveBeenCalled();
    expect(r).toEqual(ok([{ id: 'r1' }]));
    await search.execute({ query: 'dhh', view: 'visible' }, c);
    expect(c.xview.navigate).toHaveBeenCalledWith('https://x.com/search?q=dhh&src=typed_query&f=top', undefined);
  });

  it('x_read_post reads a different post in the background and never moves the visible window', async () => {
    const c = ctx('https://x.com/alice/status/111');
    await readPost.execute({ url: 'https://x.com/bob/status/2' }, c);
    expect(c.bg.navigate).toHaveBeenCalledWith('https://x.com/bob/status/2', undefined);
    expect(c.bg.callPreload).toHaveBeenLastCalledWith('x_read_current_post', {}, undefined);
    expect(c.xview.navigate).not.toHaveBeenCalled();
  });

  it('x_read_post uses the visible window only when asked, and stays put when it is already there', async () => {
    const c = ctx('https://x.com/alice/status/111');
    await readPost.execute({ url: 'https://x.com/alice/status/111', view: 'visible' }, c);
    expect(c.xview.callPreload).toHaveBeenLastCalledWith('x_read_current_post', {}, undefined);
    expect(c.xview.navigate).not.toHaveBeenCalled();
    expect(c.bg.navigate).not.toHaveBeenCalled();
    await readPost.execute({ url: 'https://x.com/bob/status/2', view: 'visible' }, c);
    expect(c.xview.navigate).toHaveBeenCalledWith('https://x.com/bob/status/2', undefined);
  });

  it('background failures surface as tool failures', async () => {
    const c = ctx();
    c.background = async () => {
      throw new Error('no session window');
    };
    expect(await search.execute({ query: 'x' }, c)).toEqual(fail('Background window unavailable: no session window'));
  });
});
