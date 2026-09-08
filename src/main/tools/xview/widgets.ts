import { ok, type ToolModule } from '../../../shared/tools';
import type { XViewToolCtx } from './context';
import { VIEW_ARG, isToolResult, parseView, pickView } from './target';

export interface WidgetSection { heading: string; items: Array<{ title: string; detail: string }> }
interface WidgetsPayload { url: string; sections: WidgetSection[] }

/** Explore shows both widgets regardless of which Home tab the user is on. */
const EXPLORE_URL = 'https://x.com/explore';
const NEWS_HEADING = /news/i;

export function hasWanted(sections: WidgetSection[], want: 'news' | 'trends' | 'both'): boolean {
  const news = sections.some((s) => NEWS_HEADING.test(s.heading) && s.items.length > 0);
  const trends = sections.some((s) => !NEWS_HEADING.test(s.heading) && s.items.length > 0);
  return want === 'news' ? news : want === 'trends' ? trends : news && trends;
}

export const readNewsAndTrends: ToolModule<XViewToolCtx> = {
  spec: {
    name: 'x_read_news_and_trends',
    description: 'Reads the "Today\'s News" headlines and "What\'s happening" trending topics (title plus context such as category, age and post count), grouped by widget heading. Uses what is already on the user\'s screen when the widgets are there; otherwise loads Explore in a hidden window without moving the user\'s view.',
    inputSchema: { type: 'object', properties: { section: { type: 'string', enum: ['news', 'trends', 'both'], description: 'Which widget you need (default both)' }, ...VIEW_ARG }, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  execute: async (args, ctx) => {
    const want = args.section === 'news' || args.section === 'trends' ? args.section : 'both';
    const explicit = typeof args.view === 'string';
    if (!explicit || args.view === 'visible') {
      const onScreen = await ctx.xview.callPreload('x_read_widgets', { timeoutMs: explicit ? 8000 : 0 });
      if (onScreen.success && hasWanted((onScreen.content as WidgetsPayload).sections, want)) return ok({ source: 'visible', ...(onScreen.content as WidgetsPayload) });
      if (args.view === 'visible') return onScreen.success ? ok({ source: 'visible', ...(onScreen.content as WidgetsPayload) }) : onScreen;
    }
    const view = await pickView(ctx, parseView(args));
    if (isToolResult(view)) return view;
    if (view.currentUrl() !== EXPLORE_URL) await view.navigate(EXPLORE_URL);
    const r = await view.callPreload('x_read_widgets', {});
    return r.success ? ok({ source: 'background', ...(r.content as WidgetsPayload) }) : r;
  },
};
