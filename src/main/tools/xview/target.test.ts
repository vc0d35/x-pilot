import { describe, it, expect, vi } from 'vitest';
import { search } from './search';
import { readTimeline } from './engage';
import { navigate } from './navigate';
import { withView } from './target';
import { ok } from '../../../shared/tools';
import { DEFAULT_ALLOW_HOSTS } from '../../../shared/settings';
import { ApprovalBroker } from '../../approvals';
import { DraftStore } from './drafts';
import type { XViewLike, XViewToolCtx } from './context';

/** Records every step in order, so interleaving between two calls on one view is visible. */
function tracingView(log: string[], tag: string): XViewLike {
  return {
    currentUrl: () => 'https://x.com/home',
    navigate: vi.fn(async () => { log.push(`${tag}:navigate`); await new Promise((r) => setTimeout(r, 5)); }),
    callPreload: vi.fn(async (name: string) => { log.push(`${tag}:${name}`); await new Promise((r) => setTimeout(r, 5)); return ok([]); }),
  };
}

function ctx(xview: XViewLike, background: XViewLike): XViewToolCtx {
  return { xview, background: async () => background, allowHosts: () => DEFAULT_ALLOW_HOSTS, approvals: new ApprovalBroker(), postingMode: () => 'confirm', likesMode: () => 'auto', drafts: new DraftStore() };
}

describe('withView', () => {
  it('runs two calls on the same view one after the other', async () => {
    const log: string[] = [];
    const bg = tracingView(log, 'bg');
    const c = ctx(tracingView(log, 'x'), bg);
    await Promise.all([search.execute({ query: 'one' }, c), search.execute({ query: 'two' }, c)]);
    expect(log).toEqual(['bg:navigate', 'bg:x_read_visible_posts', 'bg:navigate', 'bg:x_read_visible_posts']);
  });

  it('lets calls on different views run at the same time', async () => {
    const log: string[] = [];
    const interactive = tracingView(log, 'a');
    const scheduled = tracingView(log, 'b');
    await Promise.all([
      withView(ctx(interactive, interactive), 'background', async (v) => { await v.navigate('u'); return v.callPreload('x_read_visible_posts', {}); }),
      withView(ctx(scheduled, scheduled), 'background', async (v) => { await v.navigate('u'); return v.callPreload('x_read_visible_posts', {}); }),
    ]);
    expect(log).toEqual(['a:navigate', 'b:navigate', 'a:x_read_visible_posts', 'b:x_read_visible_posts']);
  });

  it('releases the lock when the tool throws', async () => {
    const log: string[] = [];
    const bg = tracingView(log, 'bg');
    const c = ctx(bg, bg);
    await expect(withView(c, 'background', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await search.execute({ query: 'after' }, c);
    expect(log).toEqual(['bg:navigate', 'bg:x_read_visible_posts']);
  });
});

describe('cancellation', () => {
  it('x_navigate does not move the window when the turn was already stopped', async () => {
    const log: string[] = [];
    const x = tracingView(log, 'x');
    const c = ctx(x, tracingView(log, 'bg'));
    expect(await navigate.execute({ url: 'https://x.com/explore' }, c, AbortSignal.abort())).toEqual({ success: false, error: 'Cancelled by the user' });
    expect(x.navigate).not.toHaveBeenCalled();
    expect(log).toEqual([]);
  });

  it('x_search reports the stop instead of the read when the signal aborts mid-navigation', async () => {
    const log: string[] = [];
    const bg = tracingView(log, 'bg');
    const c = ctx(tracingView(log, 'x'), bg);
    const ac = new AbortController();
    const p = search.execute({ query: 'q' }, c, ac.signal);
    await new Promise((r) => setTimeout(r, 0));
    ac.abort();
    expect(await p).toEqual({ success: false, error: 'Cancelled by the user' });
    expect(log).toEqual(['bg:navigate']);
  });

  it('x_read_timeline stops scrolling as soon as the turn is stopped', async () => {
    const log: string[] = [];
    const ac = new AbortController();
    const bg: XViewLike = {
      currentUrl: () => 'https://x.com/home',
      navigate: vi.fn(async () => { log.push('navigate'); }),
      callPreload: vi.fn(async (name: string) => {
        log.push(name);
        if (log.filter((l) => l === 'x_read_visible_posts').length === 2) ac.abort();
        return name === 'x_read_visible_posts' ? ok([{ id: log.length.toString() }]) : ok({});
      }),
    };
    const c = ctx(tracingView([], 'x'), bg);
    const r = await readTimeline.execute({ pages: 5 }, c, ac.signal);
    expect(r).toEqual({ success: false, error: 'Cancelled by the user' });
    expect(log.filter((l) => l === 'x_read_visible_posts')).toHaveLength(2);
    expect(log.filter((l) => l === 'x_scroll')).toHaveLength(1);
  });
});
