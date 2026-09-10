// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { inspectScript } from './inspect';

/** Runs the snippet the way `executeJavaScript` does: as an expression, against the document. */
function run(html: string, selector?: string, limit?: number): unknown {
  document.body.innerHTML = html;
  return new Function(`return ${inspectScript(selector, limit)}`)();
}

describe('inspectScript', () => {
  it('reports the tag, the identifying attributes and the markup', () => {
    expect(run('<ol id="posts"><li class="row" data-testid="post">hi</li></ol>', 'li')).toEqual({
      selector: 'li',
      matches: 1,
      elements: [
        { tag: 'li', attributes: { class: 'row', 'data-testid': 'post' }, outerHTML: '<li class="row" data-testid="post">hi</li>' },
      ],
      truncated: false,
    });
  });

  it('stops at the limit and says so', () => {
    const r = run('<ul><li>a</li><li>b</li><li>c</li></ul>', 'li', 2) as { elements: unknown[]; matches: number; truncated: boolean };
    expect(r).toMatchObject({ matches: 3, truncated: true });
    expect(r.elements).toHaveLength(2);
  });

  it('looks at the body by default and answers a selector the browser will not parse', () => {
    expect(run('<p>hello</p>')).toMatchObject({ selector: 'body', matches: 1 });
    expect(run('<p>hello</p>', '<<<')).toEqual({ error: 'That is not a valid CSS selector: <<<' });
  });

  it('cuts every attribute, not only the class, and charges them all to one budget', () => {
    const huge = 'A'.repeat(200_000);
    const r = run(`<div id="huge" aria-label="${huge}" data-testid="${huge}" role="${huge}">x</div>`, '#huge') as {
      elements: { attributes: Record<string, string> }[];
    };
    for (const [name, value] of Object.entries(r.elements[0].attributes)) expect(value.length, name).toBeLessThanOrEqual(121);
    expect(JSON.stringify(r).length).toBeLessThan(20 * 1024);
  });

  it('keeps the whole result under the total cap however many matches there are', () => {
    const cell = `<div class="dup" aria-label="${'C'.repeat(100_000)}">${'d'.repeat(3000)}</div>`;
    const r = run(`<section>${cell.repeat(25)}</section>`, '.dup', 20) as { elements: unknown[]; truncated: boolean };
    expect(JSON.stringify(r).length).toBeLessThan(20 * 1024);
    expect(r.truncated).toBe(true);
  });

  it('puts the arguments in as data, so a selector cannot become code', () => {
    const script = inspectScript("'); throw new Error('pwned'); ('", 1);
    expect(script).toContain("\"'); throw new Error('pwned'); ('\"");
    expect(run('<p>x</p>', "'); throw new Error('pwned'); ('")).toMatchObject({
      error: expect.stringContaining('not a valid CSS selector'),
    });
  });
});
