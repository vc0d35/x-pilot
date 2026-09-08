// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fixture } from '../../../../tests/fixtures';
import { installLikeCapture } from './capture';

describe('installLikeCapture', () => {
  beforeEach(() => { document.body.innerHTML = fixture('x-timeline.html'); });

  it('sends liked with the post on like click and unliked on unlike click', () => {
    const send = vi.fn();
    installLikeCapture(document, () => 'https://x.com/home', send);
    document.querySelector<HTMLElement>('button[data-testid="like"]')!.click();
    expect(send).toHaveBeenCalledWith('history:liked', { post: expect.objectContaining({ id: '111', text: 'Hello 🌍world' }), likedAt: expect.any(String) });
    document.querySelector<HTMLElement>('button[data-testid="unlike"]')!.click();
    expect(send).toHaveBeenCalledWith('history:unliked', { id: '222', at: expect.any(String) });
  });

  it('ignores clicks elsewhere and stops after uninstall', () => {
    const send = vi.fn();
    const off = installLikeCapture(document, () => 'https://x.com/home', send);
    document.querySelector<HTMLElement>('button[data-testid="reply"]')!.click();
    off();
    document.querySelector<HTMLElement>('button[data-testid="like"]')!.click();
    expect(send).not.toHaveBeenCalled();
  });

  it('trusts the pointerdown snapshot when X optimistically flips the button before click fires', () => {
    const send = vi.fn();
    installLikeCapture(document, () => 'https://x.com/home', send);
    const btn = document.querySelector<HTMLElement>('button[data-testid="like"]')!;
    btn.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    // Simulate X's optimistic re-render swapping the button into its "liked" (unlike) state
    // before the click event fires.
    btn.dataset.testid = 'unlike';
    btn.click();
    expect(send).toHaveBeenCalledWith('history:liked', { post: expect.objectContaining({ id: '111' }), likedAt: expect.any(String) });
    expect(send).not.toHaveBeenCalledWith('history:unliked', expect.anything());
  });
});
