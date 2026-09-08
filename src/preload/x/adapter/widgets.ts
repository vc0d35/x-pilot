import { NEW_POSTS_LABEL, SEL } from './selectors';
import type { WidgetItem, WidgetSection } from '../../../shared/widgets';

export type { WidgetItem, WidgetSection };

const FALLBACK_HEADING = 'Trending';
const BLOCK_TAGS = new Set(['DIV', 'P', 'LI', 'BR', 'H1', 'H2', 'H3']);
const SKIP_TAGS = new Set(['BUTTON', 'SVG', 'svg', 'STYLE', 'SCRIPT']);

/**
 * Text of an element split at block boundaries and whitespace-collapsed. A text run that repeats the previous
 * run is dropped (X renders some trend names twice, once for screen readers), as is a line equal to the last one.
 */
export function textLines(el: Element): string[] {
  const lines: string[] = [];
  let cur = '';
  let lastRun = '';
  const flush = () => { const t = cur.replace(/\s+/g, ' ').trim(); if (t && lines[lines.length - 1] !== t) lines.push(t); cur = ''; lastRun = ''; };
  const run = (t: string) => { if (t.trim() && t.trim() === lastRun) return; cur += t; if (t.trim()) lastRun = t.trim(); };
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) { run(n.textContent ?? ''); return; }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const e = n as Element;
    if (SKIP_TAGS.has(e.tagName)) return;
    if (e.tagName === 'IMG') { run(e.getAttribute('alt') ?? ''); return; }
    const block = BLOCK_TAGS.has(e.tagName);
    if (block) flush();
    for (const c of e.childNodes) walk(c);
    if (block) flush();
  };
  walk(el);
  flush();
  return lines;
}

// A trend card reads "Politics · Trending" / "Rusland" / "12.3K posts": the name is the line that is neither context nor count.
const CONTEXT_LINE = /trending|·/i;
const COUNT_LINE = /^[\d,.]+\s*[kKmM]?\s+posts?$/i;

export function widgetItem(el: Element): WidgetItem | null {
  const lines = textLines(el);
  if (lines.length === 0) return null;
  const isNews = (el.getAttribute('data-testid') ?? '').startsWith('news_sidebar_article_');
  const title = isNews ? lines[0] : lines.find((l) => !CONTEXT_LINE.test(l) && !COUNT_LINE.test(l)) ?? lines[0];
  const detail = lines.filter((l) => l !== title).join(' · ');
  return { title, detail };
}

/**
 * Grouped under the heading that precedes them in document order. An empty timeline cell ends a
 * section (Explore lists trends after Today's News with no heading of their own).
 */
export function extractWidgets(root: ParentNode): WidgetSection[] {
  const sections: WidgetSection[] = [];
  const byHeading = new Map<string, WidgetSection>();
  let heading: string | null = null;
  const add = (item: WidgetItem) => {
    const key = heading ?? FALLBACK_HEADING;
    let s = byHeading.get(key);
    if (!s) { s = { heading: key, items: [] }; byHeading.set(key, s); sections.push(s); }
    if (!s.items.some((i) => i.title === item.title)) s.items.push(item);
  };
  const itemSel = `${SEL.trend}, ${SEL.newsArticle}`;
  for (const el of root.querySelectorAll(`${SEL.sectionHeading}, ${itemSel}, ${SEL.timelineCell}`)) {
    if (el.matches(itemSel)) { const it = widgetItem(el); if (it) add(it); continue; }
    if (el.matches(SEL.sectionHeading)) { heading = (el.textContent ?? '').replace(/\s+/g, ' ').trim() || null; continue; }
    if (!(el.textContent ?? '').trim() && !el.querySelector(itemSel)) heading = null;
  }
  return sections;
}

export function findNewPostsButton(root: ParentNode): { button: HTMLElement; count: number } | null {
  for (const b of root.querySelectorAll<HTMLElement>(SEL.newPostsButton)) {
    const m = NEW_POSTS_LABEL.exec((b.textContent ?? '').trim());
    if (m) return { button: b, count: Number(m[1].replace(/,/g, '')) || 0 };
  }
  return null;
}
