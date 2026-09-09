// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { inspectPage } from './inspect-page';
import { runTool } from '../../../../shared/tools';

type Result = { success: true; content: { selector: string; matches: number; elements: Element[]; truncated: boolean } };
type Element = { tag: string; attributes: Record<string, string>; outerHTML: string };

const run = (args: Record<string, unknown>) => runTool(inspectPage, args, {}) as Promise<Result>;

describe('x_inspect_page', () => {
  it('reports the tag, the identifying attributes and the markup of each match', async () => {
    document.body.innerHTML =
      '<article data-testid="tweet" role="article" aria-label="Post" class="css-1 css-2"><a href="/alice/status/1">t</a></article>';
    const r = await run({ selector: 'article' });
    expect(r.content.matches).toBe(1);
    expect(r.content.elements[0]).toMatchObject({
      tag: 'article',
      attributes: { 'data-testid': 'tweet', role: 'article', 'aria-label': 'Post', class: 'css-1 css-2' },
    });
    expect(r.content.elements[0].outerHTML).toContain('/alice/status/1');
    // Only the attributes a selector is built from, not everything the element carries.
    expect(Object.keys(r.content.elements[0].attributes)).toEqual(['data-testid', 'role', 'aria-label', 'class']);
  });

  it('looks at the body when no selector is given', async () => {
    document.body.innerHTML = '<div id="a"></div>';
    const r = await run({});
    expect(r.content.selector).toBe('body');
    expect(r.content.elements).toHaveLength(1);
    expect(r.content.elements[0].tag).toBe('body');
  });

  it('returns at most `limit` matches and says how many there were', async () => {
    document.body.innerHTML = '<p></p>'.repeat(30);
    const r = await run({ selector: 'p', limit: 3 });
    expect(r.content.matches).toBe(30);
    expect(r.content.elements).toHaveLength(3);
    expect(r.content.truncated).toBe(true);
  });

  it('truncates the markup of one element and the answer as a whole', async () => {
    document.body.innerHTML = `<div class="${'c'.repeat(400)}">${'x'.repeat(9000)}</div>`.repeat(4);
    const r = await run({ selector: 'div', limit: 20 });
    for (const el of r.content.elements) {
      expect(el.outerHTML.length).toBeLessThanOrEqual(2001);
      expect(el.attributes.class.length).toBeLessThanOrEqual(121);
    }
    expect(JSON.stringify(r.content).length).toBeLessThan(20 * 1024 + 512);
  });

  it('reports a selector the browser cannot parse rather than throwing', async () => {
    expect(await run({ selector: 'div:has(((' })).toMatchObject({ success: false, error: expect.stringContaining('not a valid') });
  });

  it('clamps a limit above the range the spec allows instead of refusing it', async () => {
    const r = (await run({ selector: 'div', limit: 50 })) as { success: boolean; content: { elements: unknown[] } };
    expect(r.success).toBe(true);
    expect(r.content.elements.length).toBeLessThanOrEqual(20);
  });
});
