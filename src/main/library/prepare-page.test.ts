// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fixture } from '../../../tests/fixtures';

const metaUrl = import.meta.url;
const source = readFileSync(fileURLToPath(new URL('./prepare-page.js', metaUrl)), 'utf8');

describe('prepare-page script', () => {
  it('waits for the article, expands show-more, injects print css and returns metadata', async () => {
    window.history.pushState({}, '', '/alice/status/111');
    document.body.innerHTML = '<header role="banner">nav</header><div data-testid="sidebarColumn">side</div>' + fixture('x-status.html');
    document.title = 'Alice on X: "Main post"';
    let clicks = 0;
    document.querySelector<HTMLElement>('[data-testid="tweet-text-show-more-link"]')!.addEventListener('click', () => clicks++);
    const result = await (new Function(`return (${source.replace(/^\s*\/\/.*$/gm, '')})`)())({ timeoutMs: 500 });
    expect(result).toEqual({ title: 'Alice on X: "Main post"', author: 'alice', id: '111' });
    expect(clicks).toBe(1);
    expect(document.getElementById('xpilot-print-css')).not.toBeNull();
  });
  it('rejects when nothing renders', async () => {
    document.body.innerHTML = '<div>empty</div>';
    await expect((new Function(`return (${source.replace(/^\s*\/\/.*$/gm, '')})`)())({ timeoutMs: 50 })).rejects.toThrow('No post rendered');
  });
});
