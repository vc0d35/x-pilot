// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { readComposer, typeInComposer, clickPostButton } from './composer';
import { runTool, type ToolModule } from '../../../../shared/tools';

const ctx = {};
const run = (tool: ToolModule<typeof ctx>, args: Record<string, unknown> = {}) => runTool(tool, args, ctx);
const openComposer = (text = '') => {
  document.body.innerHTML = `<div role="dialog"><div data-testid="tweetTextarea_0" contenteditable="true">${text}</div><button data-testid="tweetButton">Post</button></div>`;
};

describe('composer tools', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('x_read_composer fails fast when no composer is open', async () => {
    expect(await run(readComposer, { timeoutMs: 30 })).toEqual({ success: false, error: 'No composer is open' });
  });

  it('x_type_in_composer inserts text through execCommand', async () => {
    openComposer();
    let inserted = '';
    (document as unknown as { execCommand: (c: string, u: boolean, v: string) => boolean }).execCommand = (cmd, _u, v) => {
      if (cmd === 'insertText') {
        inserted = v;
        document.querySelector('[data-testid="tweetTextarea_0"]')!.textContent = v;
      }
      return true;
    };
    const r = await run(typeInComposer, { text: 'hello there' });
    expect(inserted).toBe('hello there');
    expect(r).toEqual({ success: true, content: { present: true, text: 'hello there', canSubmit: true } });
  });

  it('x_click_post_button clicks and reads the toast link', async () => {
    openComposer('hi');
    document.querySelector<HTMLElement>('[data-testid="tweetButton"]')!.addEventListener('click', () => {
      document.body.innerHTML = '<div data-testid="toast">Your post was sent. <a href="/alice/status/777">View</a></div>';
    });
    const r = await run(clickPostButton, { timeoutMs: 500 });
    expect(r).toEqual({
      success: true,
      content: { clicked: true, toast: 'Your post was sent. View', url: 'https://x.com/alice/status/777' },
    });
  });

  it('x_click_post_button refuses when the button is disabled', async () => {
    openComposer('');
    document.querySelector('[data-testid="tweetButton"]')!.setAttribute('aria-disabled', 'true');
    expect(await run(clickPostButton, {})).toEqual({
      success: false,
      error: 'Post button is disabled (empty draft or over the length limit)',
    });
  });
});
