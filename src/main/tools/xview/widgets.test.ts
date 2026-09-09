import { describe, it, expect, vi } from 'vitest';
import { hasWanted, readNewsAndTrends, type WidgetSection } from './widgets';
import { DraftStore } from './drafts';
import { ApprovalBroker } from '../../approvals';
import { ok, fail } from '../../../shared/tools';
import { DEFAULT_ALLOW_HOSTS } from '../../../shared/settings';

const news: WidgetSection = { heading: "Today's News", items: [{ title: 'Headline', detail: '1 hour ago · Other · 200 posts' }] };
const trends: WidgetSection = { heading: "What's happening", items: [{ title: 'Leclerc', detail: 'Motorsport · Trending' }] };

function view(url: string, sections: WidgetSection[] | Error) {
  const state = { url };
  return {
    state,
    currentUrl: () => state.url,
    navigate: vi.fn(async (u: string) => {
      state.url = u;
    }),
    callPreload: vi.fn(async (name: string) => {
      if (name !== 'x_read_widgets') return fail('unexpected ' + name);
      return sections instanceof Error ? fail(sections.message) : ok({ url: state.url, sections });
    }),
  };
}

function ctx(visible: WidgetSection[] | Error, bg: WidgetSection[] = [news, trends]) {
  const xview = view('https://x.com/home', visible);
  const back = view('https://x.com/alice/status/1', bg);
  return {
    xview,
    back,
    c: {
      xview,
      background: async () => back,
      allowHosts: () => DEFAULT_ALLOW_HOSTS,
      approvals: new ApprovalBroker(),
      postingMode: () => 'confirm' as const,
      likesMode: () => 'auto' as const,
      drafts: new DraftStore(),
    },
  };
}

describe('hasWanted', () => {
  it('tells news from trends by heading and requires both by default', () => {
    expect(hasWanted([news], 'news')).toBe(true);
    expect(hasWanted([news], 'trends')).toBe(false);
    expect(hasWanted([news, trends], 'both')).toBe(true);
    expect(hasWanted([{ heading: 'Trending', items: [] }], 'trends')).toBe(false);
  });
});

describe('x_read_news_and_trends', () => {
  it('answers from the visible window when the widgets are on screen, without navigating anywhere', async () => {
    const { c, xview, back } = ctx([news, trends]);
    expect(await readNewsAndTrends.execute({}, c)).toEqual(ok({ source: 'visible', url: 'https://x.com/home', sections: [news, trends] }));
    expect(xview.callPreload).toHaveBeenCalledWith('x_read_widgets', { timeoutMs: 0 }, undefined);
    expect(xview.navigate).not.toHaveBeenCalled();
    expect(back.navigate).not.toHaveBeenCalled();
  });
  it('loads Explore in the hidden window when the visible page lacks what was asked for', async () => {
    const { c, xview, back } = ctx([trends]);
    expect(await readNewsAndTrends.execute({ section: 'news' }, c)).toEqual(
      ok({ source: 'background', url: 'https://x.com/explore', sections: [news, trends] }),
    );
    expect(back.navigate).toHaveBeenCalledWith('https://x.com/explore', undefined);
    expect(xview.navigate).not.toHaveBeenCalled();
  });
  it('is satisfied by trends alone when only trends were asked for', async () => {
    const { c, back } = ctx([trends]);
    expect(await readNewsAndTrends.execute({ section: 'trends' }, c)).toMatchObject({ content: { source: 'visible' } });
    expect(back.navigate).not.toHaveBeenCalled();
  });
  it('does not reload Explore when the hidden window is already there', async () => {
    const { c, back } = ctx(new Error('boom'));
    back.state.url = 'https://x.com/explore';
    expect(await readNewsAndTrends.execute({}, c)).toMatchObject({ content: { source: 'background' } });
    expect(back.navigate).not.toHaveBeenCalled();
  });
  it('view: "visible" only reads the user\'s window and reports what is there', async () => {
    const { c, xview, back } = ctx([trends]);
    expect(await readNewsAndTrends.execute({ view: 'visible' }, c)).toEqual(
      ok({ source: 'visible', url: 'https://x.com/home', sections: [trends] }),
    );
    expect(xview.callPreload).toHaveBeenCalledWith('x_read_widgets', { timeoutMs: 8000 }, undefined);
    expect(back.navigate).not.toHaveBeenCalled();
  });
});
