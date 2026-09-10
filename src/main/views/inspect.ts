/** The attributes a hand-written UI identifies its own elements by. */
const ATTRIBUTES = ['id', 'class', 'data-testid', 'role', 'aria-label'];
const CLASS_MAX = 120;
const HTML_MAX = 2000;
const TOTAL_MAX = 20 * 1024;

export interface InspectedViewElement {
  tag: string;
  attributes: Record<string, string>;
  outerHTML: string;
}
export interface ViewInspection {
  selector: string;
  matches: number;
  elements: InspectedViewElement[];
  truncated: boolean;
}

/**
 * The snippet `xpilot_view_inspect` runs inside the canvas. It is built as source rather than
 * shipped in the view's preload because it is the agent looking at its own page from main, not
 * something a view should be able to call; the arguments go in as JSON so nothing is interpolated
 * into code. Capped the same way `x_inspect_page` is, for the same reason.
 */
export function inspectScript(selector = 'body', limit = 5): string {
  return `(() => {
  const selector = ${JSON.stringify(selector)};
  const limit = ${JSON.stringify(limit)};
  const attributes = ${JSON.stringify(ATTRIBUTES)};
  const cut = (text, max) => (text.length > max ? text.slice(0, max) + '\\u2026' : text);
  let found;
  try {
    found = [...document.querySelectorAll(selector)];
  } catch {
    return { error: 'That is not a valid CSS selector: ' + selector };
  }
  const elements = [];
  let budget = ${TOTAL_MAX};
  for (const el of found.slice(0, limit)) {
    const attrs = {};
    for (const name of attributes) {
      const value = el.getAttribute(name);
      if (value !== null) attrs[name] = name === 'class' ? cut(value, ${CLASS_MAX}) : value;
    }
    const outerHTML = cut(el.outerHTML, ${HTML_MAX});
    budget -= outerHTML.length;
    if (budget < 0) break;
    elements.push({ tag: el.tagName.toLowerCase(), attributes: attrs, outerHTML });
  }
  return { selector, matches: found.length, elements, truncated: elements.length < found.length };
})()`;
}
