// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fixture } from '../../../../tests/fixtures';
import { installLikeCapture } from './capture';

/**
 * jsdom forces `isTrusted` to false on every dispatch and the property is unforgeable, so a real user
 * gesture is simulated by flipping the flag on jsdom's internal event object from a window-level
 * capture listener — those run before the document listeners the capture installs.
 */
function trustedDispatch(el: Element, type: string): void {
  const trust = (ev: Event) => {
    for (const s of Object.getOwnPropertySymbols(ev)) {
      const impl = (ev as unknown as Record<symbol, { isTrusted?: boolean }>)[s];
      if (impl && typeof impl === 'object' && 'isTrusted' in impl) impl.isTrusted = true;
    }
  };
  window.addEventListener(type, trust, true);
  try { el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true })); }
  finally { window.removeEventListener(type, trust, true); }
}

describe('installLikeCapture', () => {
  beforeEach(() => { document.body.innerHTML = fixture('x-timeline.html'); });

  it('sends liked with the post on like click and unliked on unlike click', () => {
    const send = vi.fn();
    installLikeCapture(document, () => 'https://x.com/home', send);
    trustedDispatch(document.querySelector('button[data-testid="like"]')!, 'click');
    expect(send).toHaveBeenCalledWith('history:liked', { post: expect.objectContaining({ id: '111', text: 'Hello 🌍world' }), likedAt: expect.any(String) });
    trustedDispatch(document.querySelector('button[data-testid="unlike"]')!, 'click');
    expect(send).toHaveBeenCalledWith('history:unliked', { id: '222', at: expect.any(String) });
  });

  it('ignores clicks elsewhere and stops after uninstall', () => {
    const send = vi.fn();
    const off = installLikeCapture(document, () => 'https://x.com/home', send);
    trustedDispatch(document.querySelector('button[data-testid="reply"]')!, 'click');
    off();
    trustedDispatch(document.querySelector('button[data-testid="like"]')!, 'click');
    expect(send).not.toHaveBeenCalled();
  });

  it('ignores synthetic (page-scripted) like and unlike clicks', () => {
    const send = vi.fn();
    installLikeCapture(document, () => 'https://x.com/home', send);
    const like = document.querySelector<HTMLElement>('button[data-testid="like"]')!;
    like.click();
    like.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document.querySelector<HTMLElement>('button[data-testid="unlike"]')!.click();
    expect(send).not.toHaveBeenCalled();
  });

  it('ignores the reported forgery: a scripted click on a hidden, injected article', () => {
    const send = vi.fn();
    installLikeCapture(document, () => 'https://x.com/home', send);
    document.body.insertAdjacentHTML('beforeend', `
      <article data-testid="tweet" style="display:none">
        <div data-testid="User-Name"><a role="link" href="/nytimes"><span>@nytimes</span></a></div>
        <a href="/attacker/status/424242" role="link"><time datetime="2026-09-01T10:00:00.000Z">Sep 1</time></a>
        <div data-testid="tweetText"><span>attacker chosen text</span></div>
        <div role="group" aria-label="0 replies, 0 reposts, 0 likes, 0 views"><button data-testid="like"></button></div>
      </article>`);
    document.querySelectorAll<HTMLElement>('button[data-testid="like"]')[1].click();
    expect(send).not.toHaveBeenCalled();
  });

  it('trusts the pointerdown snapshot when X optimistically flips the button before click fires', () => {
    const send = vi.fn();
    installLikeCapture(document, () => 'https://x.com/home', send);
    const btn = document.querySelector<HTMLElement>('button[data-testid="like"]')!;
    trustedDispatch(btn, 'pointerdown');
    // Simulate X's optimistic re-render swapping the button into its "liked" (unlike) state
    // before the click event fires.
    btn.dataset.testid = 'unlike';
    trustedDispatch(btn, 'click');
    expect(send).toHaveBeenCalledWith('history:liked', { post: expect.objectContaining({ id: '111' }), likedAt: expect.any(String) });
    expect(send).not.toHaveBeenCalledWith('history:unliked', expect.anything());
  });

  it('ignores a synthetic pointerdown that tries to seed the snapshot for a later real click', () => {
    const send = vi.fn();
    installLikeCapture(document, () => 'https://x.com/home', send);
    const btn = document.querySelector<HTMLElement>('button[data-testid="unlike"]')!;
    btn.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    trustedDispatch(btn, 'click');
    expect(send).toHaveBeenCalledWith('history:unliked', { id: '222', at: expect.any(String) });
  });
});
