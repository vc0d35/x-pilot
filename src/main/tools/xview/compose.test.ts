import { describe, it, expect, vi } from 'vitest';
import { composePost, submitPost, buildIntentUrl } from './compose';
import { DraftStore } from './drafts';
import { ApprovalBroker } from '../../approvals';
import { ok, fail } from '../../../shared/tools';
import { DEFAULT_ALLOW_HOSTS } from '../../../shared/settings';
import type { AgentEvent } from '../../../shared/agent';

function ctx(mode: 'confirm' | 'autonomous', composerText = 'hello world') {
  const approvals = new ApprovalBroker();
  const events: AgentEvent[] = [];
  approvals.onEvent((e) => events.push(e));
  const xview = {
    currentUrl: () => 'https://x.com/home',
    navigate: vi.fn(async () => {}),
    callPreload: vi.fn(async (name: string) => {
      if (name === 'x_read_composer') return ok({ present: true, text: composerText, canSubmit: composerText.length > 0 });
      if (name === 'x_type_in_composer') return ok({ present: true, text: 'typed', canSubmit: true });
      if (name === 'x_click_post_button') return ok({ clicked: true, toast: 'sent', url: 'https://x.com/me/status/1' });
      return fail('unexpected ' + name);
    }),
  };
  return {
    c: {
      xview,
      background: async () => xview,
      allowHosts: () => DEFAULT_ALLOW_HOSTS,
      approvals,
      postingMode: () => mode,
      likesMode: () => 'auto' as const,
      bookmarksMode: () => 'auto' as const,
      likes: { recordLike: vi.fn(), recordUnlike: vi.fn() },
      drafts: new DraftStore(),
    },
    events,
    approvals,
  };
}

describe('buildIntentUrl', () => {
  it('encodes text, reply id and quote url', () => {
    expect(buildIntentUrl('hi there')).toBe('https://x.com/intent/post?text=hi%20there');
    expect(buildIntentUrl('hi', 'https://x.com/a/status/42')).toBe('https://x.com/intent/post?text=hi&in_reply_to=42');
    expect(buildIntentUrl('look', undefined, 'https://twitter.com/a/status/42?s=1')).toBe(
      'https://x.com/intent/post?text=look%20https%3A%2F%2Fx.com%2Fa%2Fstatus%2F42',
    );
  });
});

describe('x_compose_post', () => {
  it('opens the intent url and returns a draft from the composer text', async () => {
    const { c } = ctx('confirm');
    const r = (await composePost.execute({ text: 'hello world' }, c)) as {
      success: true;
      content: { draftId: string; preview: string; target: string };
    };
    expect(c.xview.navigate).toHaveBeenCalledWith('https://x.com/intent/post?text=hello%20world', undefined);
    expect(r.content.preview).toBe('hello world');
    expect(r.content.target).toBe('new post');
    expect(c.drafts.get(r.content.draftId)?.text).toBe('hello world');
  });
  it('types the text when the intent url did not prefill', async () => {
    const { c } = ctx('confirm', '');
    const r = (await composePost.execute({ text: 'x' }, c)) as { content: { preview: string } };
    expect(c.xview.callPreload).toHaveBeenCalledWith('x_type_in_composer', { text: 'x' }, undefined);
    expect(r.content.preview).toBe('typed');
  });
  it('rejects an invalid replyToUrl', async () => {
    const { c } = ctx('confirm');
    expect(await composePost.execute({ text: 'x', replyToUrl: 'https://x.com/a' }, c)).toEqual(
      fail('replyToUrl is not a post URL: https://x.com/a'),
    );
  });
});

describe('x_submit_post', () => {
  it('in confirm mode waits for approval and posts on "post"', async () => {
    const { c, events, approvals } = ctx('confirm');
    const draft = c.drafts.create({ text: 'hello world', target: 'new post', view: 'visible' });
    const p = submitPost.execute({ draftId: draft.id }, c);
    await new Promise((r) => setTimeout(r, 0));
    const req = (events[0] as { request: { id: string; detail: string; kind: string } }).request;
    expect(req.kind).toBe('post');
    expect(req.detail).toContain('hello world');
    approvals.resolve(req.id, 'post');
    expect(await p).toEqual(ok({ posted: true, url: 'https://x.com/me/status/1' }));
    expect(c.drafts.get(draft.id)).toBeUndefined();
  });
  it('in confirm mode cancel navigates home and reports not posted', async () => {
    const { c, events, approvals } = ctx('confirm');
    const draft = c.drafts.create({ text: 'hello world', target: 'new post', view: 'visible' });
    const p = submitPost.execute({ draftId: draft.id }, c);
    await new Promise((r) => setTimeout(r, 0));
    approvals.resolve((events[0] as { request: { id: string } }).request.id, 'cancel');
    expect(await p).toEqual(
      ok({
        posted: false,
        status: 'cancelled_by_user',
        url: null,
        reason: 'The user reviewed the draft and chose not to post it; the draft was discarded.',
      }),
    );
    expect(c.xview.navigate).toHaveBeenCalledWith('https://x.com/home', undefined);
    expect(c.xview.callPreload).not.toHaveBeenCalledWith('x_click_post_button', expect.anything());
  });
  it('re-reads the composer after approval and refuses to post when the text changed', async () => {
    const { c, events, approvals } = ctx('confirm');
    let reads = 0;
    c.xview.callPreload.mockImplementation(async (name: string) => {
      if (name === 'x_read_composer') {
        reads += 1;
        return ok({ present: true, text: reads === 1 ? 'hello world' : 'buy my coin', canSubmit: true });
      }
      if (name === 'x_click_post_button') return ok({ clicked: true, toast: 'sent', url: 'https://x.com/me/status/1' });
      return fail('unexpected ' + name);
    });
    const draft = c.drafts.create({ text: 'hello world', target: 'new post', view: 'visible' });
    const p = submitPost.execute({ draftId: draft.id }, c);
    await new Promise((r) => setTimeout(r, 0));
    approvals.resolve((events[0] as { request: { id: string } }).request.id, 'post');
    expect(await p).toEqual(fail('Composer changed after approval; not posting'));
    expect(c.xview.callPreload).not.toHaveBeenCalledWith('x_click_post_button', expect.anything());
    expect(c.drafts.get(draft.id)).toBeUndefined();
  });

  it('in autonomous mode posts without asking', async () => {
    const { c, events } = ctx('autonomous');
    const draft = c.drafts.create({ text: 'hello world', target: 'new post', view: 'visible' });
    expect(await submitPost.execute({ draftId: draft.id }, c)).toEqual(ok({ posted: true, url: 'https://x.com/me/status/1' }));
    expect(events).toEqual([]);
  });
  it('fails for unknown drafts or a closed composer', async () => {
    const { c } = ctx('autonomous');
    expect(await submitPost.execute({ draftId: 'nope' }, c)).toEqual(fail('Unknown draftId; call x_compose_post first'));
    const draft = c.drafts.create({ text: 't', target: 'new post', view: 'visible' });
    c.xview.callPreload.mockImplementationOnce(async () => fail('No composer is open'));
    expect(await submitPost.execute({ draftId: draft.id }, c)).toEqual(fail('No composer is open'));
  });
});

/** A scheduled run that may not touch the user's window: its visible view refuses everything. */
function runCtx(mode: 'confirm' | 'autonomous') {
  const approvals = new ApprovalBroker();
  const events: AgentEvent[] = [];
  approvals.onEvent((e) => events.push(e));
  const refusing = {
    isAvailable: () => false,
    currentUrl: () => '',
    navigate: vi.fn(async () => {
      throw new Error("Scheduled runs cannot move the user's window");
    }),
    callPreload: vi.fn(async () => fail("The user's window is not available in a scheduled run; use background reads")),
  };
  const hidden = {
    currentUrl: () => 'https://x.com/home',
    navigate: vi.fn(async () => {}),
    callPreload: vi.fn(async (name: string) => {
      if (name === 'x_read_composer') return ok({ present: true, text: 'Amsterdam: 14°C, light rain', canSubmit: true });
      if (name === 'x_click_post_button') return ok({ clicked: true, toast: 'sent', url: 'https://x.com/me/status/9' });
      return fail('unexpected ' + name);
    }),
  };
  return {
    c: {
      xview: refusing,
      hidden,
      background: async () => hidden,
      allowHosts: () => DEFAULT_ALLOW_HOSTS,
      approvals,
      postingMode: () => mode,
      likesMode: () => 'auto' as const,
      bookmarksMode: () => 'auto' as const,
      likes: { recordLike: vi.fn(), recordUnlike: vi.fn() },
      drafts: new DraftStore(),
    },
    events,
    approvals,
  };
}

describe('posting from a scheduled run with no window of its own', () => {
  it('composes in the run\u2019s hidden window instead of refusing', async () => {
    const { c } = runCtx('confirm');
    const r = (await composePost.execute({ text: 'Amsterdam: 14°C, light rain' }, c)) as {
      success: true;
      content: { draftId: string; preview: string };
    };
    expect(r.success).toBe(true);
    expect(c.hidden.navigate).toHaveBeenCalledWith('https://x.com/intent/post?text=Amsterdam%3A%2014%C2%B0C%2C%20light%20rain', undefined);
    expect(c.xview.navigate).not.toHaveBeenCalled();
    expect(c.drafts.get(r.content.draftId)?.view).toBe('background');
  });

  it('still asks for confirmation, and posts through the window that holds the draft', async () => {
    const { c, events, approvals } = runCtx('confirm');
    const composed = (await composePost.execute({ text: 'Amsterdam: 14°C, light rain' }, c)) as {
      content: { draftId: string };
    };
    const p = submitPost.execute({ draftId: composed.content.draftId }, c);
    await new Promise((r) => setTimeout(r, 0));
    const req = (events[0] as { request: { id: string; title: string; detail: string } }).request;
    expect(req.title).toBe('Post this new post?');
    expect(req.detail).toBe('Amsterdam: 14°C, light rain');
    approvals.resolve(req.id, 'post');
    expect(await p).toEqual(ok({ posted: true, url: 'https://x.com/me/status/9' }));
    expect(c.hidden.callPreload).toHaveBeenCalledWith('x_click_post_button', {}, undefined);
    expect(c.xview.callPreload).not.toHaveBeenCalled();
  });

  it('posts with no card when the user set posting to autonomous', async () => {
    const { c, events } = runCtx('autonomous');
    const composed = (await composePost.execute({ text: 'Amsterdam: 14°C, light rain' }, c)) as { content: { draftId: string } };
    expect(await submitPost.execute({ draftId: composed.content.draftId }, c)).toEqual(
      ok({ posted: true, url: 'https://x.com/me/status/9' }),
    );
    expect(events).toEqual([]);
  });

  it('leaves a run that has the user\u2019s window composing on screen, as before', async () => {
    const { c } = ctx('confirm');
    const r = (await composePost.execute({ text: 'hello world' }, c)) as { content: { draftId: string } };
    expect(c.drafts.get(r.content.draftId)?.view).toBe('visible');
    expect(c.xview.navigate).toHaveBeenCalled();
  });
});
