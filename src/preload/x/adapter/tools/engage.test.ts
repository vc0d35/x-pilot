// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { fixture } from '../../../../../tests/fixtures';
import { likeInPage, selectHomeTab } from './engage';

const ctx = {};

describe('x_like_in_page', () => {
  beforeEach(() => {
    document.body.innerHTML = fixture('x-timeline.html');
    // Simulate X flipping the button on click.
    for (const b of document.querySelectorAll<HTMLElement>('button[data-testid="like"], button[data-testid="unlike"]')) {
      b.addEventListener('click', () => { b.dataset.testid = b.dataset.testid === 'like' ? 'unlike' : 'like'; });
    }
  });
  it('likes a post rendered on the page and reports the change', async () => {
    expect(await likeInPage.execute({ url: 'https://x.com/alice/status/111' }, ctx)).toEqual({ success: true, content: { postId: '111', liked: true, changed: true } });
  });
  it('is idempotent when the post is already liked, and can unlike', async () => {
    expect(await likeInPage.execute({ url: '222' }, ctx)).toEqual({ success: true, content: { postId: '222', liked: true, changed: false } });
    expect(await likeInPage.execute({ url: '222', action: 'unlike' }, ctx)).toEqual({ success: true, content: { postId: '222', liked: false, changed: true } });
  });
  it('fails when the post is not on the page', async () => {
    document.body.innerHTML = '';
    expect(await likeInPage.execute({ url: 'https://x.com/x/status/999', timeoutMs: 50 }, ctx)).toEqual({ success: false, error: 'Post 999 is not rendered on this page' });
  });
});

describe('x_select_home_tab', () => {
  it('clicks the matching tab unless already selected', async () => {
    document.body.innerHTML = '<div role="tablist"><a role="tab" aria-selected="true">For you</a><a role="tab" aria-selected="false">Following</a></div>';
    let clicked = 0;
    document.querySelectorAll('[role="tab"]')[1].addEventListener('click', () => clicked++);
    expect(await selectHomeTab.execute({ label: 'for you' }, ctx)).toEqual({ success: true, content: { label: 'For you', changed: false } });
    expect(await selectHomeTab.execute({ label: 'Following' }, ctx)).toEqual({ success: true, content: { label: 'Following', changed: true } });
    expect(clicked).toBe(1);
    expect(await selectHomeTab.execute({ label: 'Nope' }, ctx)).toEqual({ success: false, error: 'No tab labelled "Nope"' });
  });
});
