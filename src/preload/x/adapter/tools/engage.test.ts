// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { fixture } from '../../../../../tests/fixtures';
import { bookmarkInPage, likeInPage, selectHomeTab } from './engage';
import { runTool, type ToolModule } from '../../../../shared/tools';

const ctx = {};
const run = (tool: ToolModule<typeof ctx>, args: Record<string, unknown> = {}) => runTool(tool, args, ctx);

describe('x_like_in_page', () => {
  beforeEach(() => {
    document.body.innerHTML = fixture('x-timeline.html');
    // Simulate X flipping the button on click.
    for (const b of document.querySelectorAll<HTMLElement>('button[data-testid="like"], button[data-testid="unlike"]')) {
      b.addEventListener('click', () => {
        b.dataset.testid = b.dataset.testid === 'like' ? 'unlike' : 'like';
      });
    }
  });
  it('likes a post rendered on the page and reports the change', async () => {
    expect(await run(likeInPage, { url: 'https://x.com/alice/status/111' })).toEqual({
      success: true,
      content: { postId: '111', liked: true, changed: true },
    });
  });
  it('is idempotent when the post is already liked, and can unlike', async () => {
    expect(await run(likeInPage, { url: '222' })).toEqual({ success: true, content: { postId: '222', liked: true, changed: false } });
    expect(await run(likeInPage, { url: '222', action: 'unlike' })).toEqual({
      success: true,
      content: { postId: '222', liked: false, changed: true },
    });
  });
  it('fails when the post is not on the page', async () => {
    document.body.innerHTML = '';
    expect(await run(likeInPage, { url: 'https://x.com/x/status/999', timeoutMs: 50 })).toEqual({
      success: false,
      error: 'Post 999 is not rendered on this page',
    });
  });
});

describe('x_bookmark_in_page', () => {
  beforeEach(() => {
    document.body.innerHTML = fixture('x-timeline.html');
    // Simulate X flipping the button on click.
    for (const b of document.querySelectorAll<HTMLElement>('button[data-testid="bookmark"], button[data-testid="removeBookmark"]')) {
      b.addEventListener('click', () => {
        b.dataset.testid = b.dataset.testid === 'bookmark' ? 'removeBookmark' : 'bookmark';
      });
    }
  });
  it('bookmarks a post rendered on the page and reports the change', async () => {
    expect(await run(bookmarkInPage, { url: 'https://x.com/alice/status/111' })).toEqual({
      success: true,
      content: { postId: '111', bookmarked: true, changed: true },
    });
  });
  it('is idempotent when the post is already bookmarked, and can unbookmark', async () => {
    expect(await run(bookmarkInPage, { url: '222' })).toEqual({
      success: true,
      content: { postId: '222', bookmarked: true, changed: false },
    });
    expect(await run(bookmarkInPage, { url: '222', action: 'unbookmark' })).toEqual({
      success: true,
      content: { postId: '222', bookmarked: false, changed: true },
    });
  });
  it('fails when the post is not on the page', async () => {
    document.body.innerHTML = '';
    expect(await run(bookmarkInPage, { url: 'https://x.com/x/status/999', timeoutMs: 50 })).toEqual({
      success: false,
      error: 'Post 999 is not rendered on this page',
    });
  });
});

describe('x_select_home_tab', () => {
  it('clicks the matching tab unless already selected', async () => {
    document.body.innerHTML =
      '<div role="tablist"><a role="tab" aria-selected="true">For you</a><a role="tab" aria-selected="false">Following</a></div>';
    let clicked = 0;
    document.querySelectorAll('[role="tab"]')[1].addEventListener('click', () => clicked++);
    expect(await run(selectHomeTab, { label: 'for you' })).toEqual({ success: true, content: { label: 'For you', changed: false } });
    expect(await run(selectHomeTab, { label: 'Following' })).toEqual({ success: true, content: { label: 'Following', changed: true } });
    expect(clicked).toBe(1);
    expect(await run(selectHomeTab, { label: 'Nope' })).toEqual({ success: false, error: 'No tab labelled "Nope"' });
  });
});
