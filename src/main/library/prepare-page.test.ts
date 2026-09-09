// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SELECTOR_DEFAULTS } from '../../shared/selectors';
import { fixture } from '../../../tests/fixtures';

const metaUrl = import.meta.url;
const source = readFileSync(fileURLToPath(new URL('./prepare-page.js', metaUrl)), 'utf8');
const prepare = () => new Function(`return (${source.replace(/^\s*\/\/.*$/gm, '')})`)() as (o: object) => Promise<unknown>;

describe('prepare-page script', () => {
  it('waits for the article, expands show-more, injects print css and returns metadata', async () => {
    window.history.pushState({}, '', '/alice/status/111');
    document.body.innerHTML = '<header role="banner">nav</header><div data-testid="sidebarColumn">side</div>' + fixture('x-status.html');
    document.title = 'Alice on X: "Main post"';
    let clicks = 0;
    document.querySelector<HTMLElement>('[data-testid="tweet-text-show-more-link"]')!.addEventListener('click', () => clicks++);
    const result = await prepare()({ timeoutMs: 500, sel: SELECTOR_DEFAULTS });
    expect(result).toEqual({ title: 'Alice on X: "Main post"', author: 'alice', id: '111' });
    expect(clicks).toBe(1);
    expect(document.getElementById('xpilot-print-css')).not.toBeNull();
  });
  it('uses the selectors it is handed, so an override repaired for the adapter fixes the exporter too', async () => {
    window.history.pushState({}, '', '/alice/status/111');
    document.body.innerHTML = fixture('x-status.html')
      .replace(/article\b/g, 'section')
      .replace(/data-testid="tweet"/g, 'data-post="1"');
    document.title = 'Alice on X';
    const sel = { ...SELECTOR_DEFAULTS, article: 'section[data-post="1"]' };
    // The shipped selector finds nothing in this markup; only the override does.
    await expect(prepare()({ timeoutMs: 50, sel: SELECTOR_DEFAULTS })).rejects.toThrow('No post rendered');
    expect(await prepare()({ timeoutMs: 500, sel })).toMatchObject({ author: 'alice', id: '111' });
  });

  it('rejects when nothing renders', async () => {
    document.body.innerHTML = '<div>empty</div>';
    await expect(prepare()({ timeoutMs: 50, sel: SELECTOR_DEFAULTS })).rejects.toThrow('No post rendered');
  });
});
