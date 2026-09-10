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

  it('puts the arguments in as data, so a selector cannot become code', () => {
    const script = inspectScript("'); throw new Error('pwned'); ('", 1);
    expect(script).toContain("\"'); throw new Error('pwned'); ('\"");
    expect(run('<p>x</p>', "'); throw new Error('pwned'); ('")).toMatchObject({
      error: expect.stringContaining('not a valid CSS selector'),
    });
  });
});
