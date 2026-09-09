import { defineTool, fail, ok } from '../../../../shared/tools';
import type { PreloadCtx } from '../../context';
import { inspectPageDef } from './specs';

/** The attributes X actually identifies its own elements by, which is what a selector is built from. */
const ATTRIBUTES = ['data-testid', 'role', 'aria-label', 'href', 'class'] as const;
const CLASS_MAX = 120;
const HTML_MAX = 2000;
const TOTAL_MAX = 20 * 1024;

export interface InspectedElement {
  tag: string;
  attributes: Record<string, string>;
  outerHTML: string;
}

const cut = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}…` : text);

export function inspectElement(el: Element): InspectedElement {
  const attributes: Record<string, string> = {};
  for (const name of ATTRIBUTES) {
    const value = el.getAttribute(name);
    // `class` on an X element is a wall of atomic utility classes; the first line of it is enough
    // to tell two elements apart without spending the budget on it.
    if (value !== null) attributes[name] = name === 'class' ? cut(value, CLASS_MAX) : value;
  }
  return { tag: el.tagName.toLowerCase(), attributes, outerHTML: cut(el.outerHTML, HTML_MAX) };
}

/**
 * A window on X's markup, so a broken selector can be repaired by looking rather than by guessing.
 * Page data like any other read: it comes back fenced as untrusted content.
 */
export const inspectPage = defineTool({
  ...inspectPageDef,
  execute: async (args, _ctx: PreloadCtx) => {
    const selector = args.selector ?? 'body';
    let found: Element[];
    try {
      found = [...document.querySelectorAll(selector)];
    } catch {
      return fail(`That is not a valid CSS selector: ${selector}`);
    }
    const elements: InspectedElement[] = [];
    let budget = TOTAL_MAX;
    for (const el of found.slice(0, args.limit)) {
      const inspected = inspectElement(el);
      budget -= inspected.outerHTML.length;
      if (budget < 0) break;
      elements.push(inspected);
    }
    // True whenever more matched than came back, whether the limit or the size budget stopped it.
    return ok({ selector, matches: found.length, elements, truncated: elements.length < found.length });
  },
});
