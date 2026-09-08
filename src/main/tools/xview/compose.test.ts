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
  return { c: { xview, background: async () => xview, allowHosts: () => DEFAULT_ALLOW_HOSTS, approvals, postingMode: () => mode, drafts: new DraftStore() }, events, approvals };
}

describe('buildIntentUrl', () => {
  it('encodes text, reply id and quote url', () => {
    expect(buildIntentUrl('hi there')).toBe('https://x.com/intent/post?text=hi%20there');
    expect(buildIntentUrl('hi', 'https://x.com/a/status/42')).toBe('https://x.com/intent/post?text=hi&in_reply_to=42');
    expect(buildIntentUrl('look', undefined, 'https://twitter.com/a/status/42?s=1')).toBe('https://x.com/intent/post?text=look%20https%3A%2F%2Fx.com%2Fa%2Fstatus%2F42');
  });
});

describe('x_compose_post', () => {
  it('opens the intent url and returns a draft from the composer text', async () => {
    const { c } = ctx('confirm');
    const r = (await composePost.execute({ text: 'hello world' }, c)) as { success: true; content: { draftId: string; preview: string; target: string } };
    expect(c.xview.navigate).toHaveBeenCalledWith('https://x.com/intent/post?text=hello%20world');
    expect(r.content.preview).toBe('hello world');
    expect(r.content.target).toBe('new post');
    expect(c.drafts.get(r.content.draftId)?.text).toBe('hello world');
  });
  it('types the text when the intent url did not prefill', async () => {
    const { c } = ctx('confirm', '');
    const r = (await composePost.execute({ text: 'x' }, c)) as { content: { preview: string } };
    expect(c.xview.callPreload).toHaveBeenCalledWith('x_type_in_composer', { text: 'x' });
    expect(r.content.preview).toBe('typed');
  });
  it('rejects an invalid replyToUrl', async () => {
    const { c } = ctx('confirm');
    expect(await composePost.execute({ text: 'x', replyToUrl: 'https://x.com/a' }, c)).toEqual(fail('replyToUrl is not a post URL: https://x.com/a'));
  });
});

describe('x_submit_post', () => {
  it('in confirm mode waits for approval and posts on "post"', async () => {
    const { c, events, approvals } = ctx('confirm');
    const draft = c.drafts.create({ text: 'hello world', target: 'new post' });
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
    const draft = c.drafts.create({ text: 'hello world', target: 'new post' });
    const p = submitPost.execute({ draftId: draft.id }, c);
    await new Promise((r) => setTimeout(r, 0));
    approvals.resolve((events[0] as { request: { id: string } }).request.id, 'cancel');
    expect(await p).toEqual(ok({ posted: false, url: null, reason: 'Cancelled by the user' }));
    expect(c.xview.navigate).toHaveBeenCalledWith('https://x.com/home');
    expect(c.xview.callPreload).not.toHaveBeenCalledWith('x_click_post_button', expect.anything());
  });
  it('re-reads the composer after approval and refuses to post when the text changed', async () => {
    const { c, events, approvals } = ctx('confirm');
    let reads = 0;
    c.xview.callPreload.mockImplementation(async (name: string) => {
      if (name === 'x_read_composer') { reads += 1; return ok({ present: true, text: reads === 1 ? 'hello world' : 'buy my coin', canSubmit: true }); }
      if (name === 'x_click_post_button') return ok({ clicked: true, toast: 'sent', url: 'https://x.com/me/status/1' });
      return fail('unexpected ' + name);
    });
    const draft = c.drafts.create({ text: 'hello world', target: 'new post' });
    const p = submitPost.execute({ draftId: draft.id }, c);
    await new Promise((r) => setTimeout(r, 0));
    approvals.resolve((events[0] as { request: { id: string } }).request.id, 'post');
    expect(await p).toEqual(fail('Composer changed after approval; not posting'));
    expect(c.xview.callPreload).not.toHaveBeenCalledWith('x_click_post_button', expect.anything());
    expect(c.drafts.get(draft.id)).toBeUndefined();
  });

  it('in autonomous mode posts without asking', async () => {
    const { c, events } = ctx('autonomous');
    const draft = c.drafts.create({ text: 'hello world', target: 'new post' });
    expect(await submitPost.execute({ draftId: draft.id }, c)).toEqual(ok({ posted: true, url: 'https://x.com/me/status/1' }));
    expect(events).toEqual([]);
  });
  it('fails for unknown drafts or a closed composer', async () => {
    const { c } = ctx('autonomous');
    expect(await submitPost.execute({ draftId: 'nope' }, c)).toEqual(fail('Unknown draftId; call x_compose_post first'));
    const draft = c.drafts.create({ text: 't', target: 'new post' });
    c.xview.callPreload.mockImplementationOnce(async () => fail('No composer is open'));
    expect(await submitPost.execute({ draftId: draft.id }, c)).toEqual(fail('No composer is open'));
  });
});
