// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { installLikeCapture } from './capture';

const here = import.meta.url;
const fixture = (n: string) => readFileSync(fileURLToPath(new URL(`../../../../tests/fixtures/${n}`, here)), 'utf8');

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
});
