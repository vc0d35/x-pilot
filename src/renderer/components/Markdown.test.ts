import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from './Markdown';

const render = (text: string) => renderToStaticMarkup(createElement(Markdown, { text }));

describe('Markdown links', () => {
  it('shows the real host after link text that names a different one', () => {
    const html = render('[https://x.com/safe](https://evil.com/phish)');
    expect(html).toContain('<span class="link-host"> (evil.com)</span>');
    expect(html).toContain('title="https://evil.com/phish"');
  });

  it('leaves honest links and prose link text alone', () => {
    expect(render('[Your bookmarks](https://x.com/i/flow/login)')).not.toContain('link-host');
    expect(render('Visit www.evil.com now')).not.toContain('link-host');
    expect(render('[https://x.com/safe](https://x.com/safe)')).not.toContain('link-host');
  });

  it('sees through formatted link text', () => {
    expect(render('[**x.com**/safe](https://evil.com)')).toContain('(evil.com)');
  });
});
