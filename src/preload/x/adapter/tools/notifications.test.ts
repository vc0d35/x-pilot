// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { fixture } from '../../../../../tests/fixtures';
import { openNotificationInPage, readNotificationsInPage } from './notifications';
import { extractNotifications } from '../extract';
import { runTool, type ToolModule } from '../../../../shared/tools';

const ctx = {};
const run = (tool: ToolModule<typeof ctx>, args: Record<string, unknown> = {}) => runTool(tool, args, ctx);

describe('x_read_notifications_in_page', () => {
  beforeEach(() => {
    document.body.innerHTML = fixture('x-notifications.html');
  });
  it('returns the entries, up to the limit', async () => {
    const r = (await run(readNotificationsInPage, { limit: 2 })) as { success: true; content: { kind: string }[] };
    expect(r.success).toBe(true);
    expect(r.content.map((e) => e.kind)).toEqual(['post', 'like']);
  });
});

describe('x_open_notification_in_page', () => {
  beforeEach(() => {
    document.body.innerHTML = fixture('x-notifications.html');
    location.hash = '';
  });
  it('answers a reply or mention with its own post URL, clicking nothing', async () => {
    const [reply] = extractNotifications(document);
    expect(await run(openNotificationInPage, { id: reply.id })).toEqual({
      success: true,
      content: { id: reply.id, url: 'https://x.com/serros404/status/2098773361820065897', navigated: false },
    });
  });
  it('clicks a like entry and reports where the page went', async () => {
    const like = extractNotifications(document)[1];
    // X's own handler: the cell navigates to the post the like is about.
    document.querySelectorAll('article[data-testid="notification"]')[0].addEventListener('click', () => {
      location.hash = '#/v_c0d35/status/42';
    });
    const r = (await run(openNotificationInPage, { id: like.id, timeoutMs: 1000 })) as {
      success: true;
      content: { url: string; navigated: boolean };
    };
    expect(r.success).toBe(true);
    expect(r.content.navigated).toBe(true);
    expect(r.content.url).toContain('#/v_c0d35/status/42');
  });
  it('fails when the click leads nowhere, and when the id is not on the page', async () => {
    const follow = extractNotifications(document)[4];
    expect(await run(openNotificationInPage, { id: follow.id, timeoutMs: 50 })).toEqual({
      success: false,
      error: 'Opening the notification did not take the page anywhere',
    });
    expect(await run(openNotificationInPage, { id: 'deadbeef', timeoutMs: 50 })).toMatchObject({
      success: false,
      error: expect.stringContaining('further down'),
    });
  });
});
