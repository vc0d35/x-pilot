import { z } from 'zod';
import { defineTool, fail, ok } from '../../../shared/tools';
import type { XViewToolCtx } from './context';
import { normalizePostUrl } from './read-post';
import { cancelled, navigateStep, withView } from './target';

const POST_CONFIRM_TIMEOUT_MS = 5 * 60 * 1000;

export function buildIntentUrl(text: string, replyToUrl?: string, quoteUrl?: string): string {
  let body = text;
  const params = new URLSearchParams();
  if (quoteUrl) body = `${body} ${normalizePostUrl(quoteUrl)}`;
  params.set('text', body);
  if (replyToUrl) params.set('in_reply_to', /\/status\/(\d+)/.exec(normalizePostUrl(replyToUrl) ?? '')![1]);
  return `https://x.com/intent/post?${params.toString().replace(/\+/g, '%20')}`;
}

export const composePost = defineTool({
  name: 'x_compose_post',
  description: 'Opens the composer with the given text (optionally as a reply to replyToUrl or quoting quoteUrl) and returns a draftId plus the exact preview. Does NOT post; call x_submit_post with the draftId to send.',
  args: z.strictObject({ text: z.string(), replyToUrl: z.string().optional(), quoteUrl: z.string().optional() }),
  execute: async (args, ctx: XViewToolCtx, signal) => {
    const text = args.text.trim();
    if (!text) return fail('text is required');
    const { replyToUrl, quoteUrl } = args;
    if (replyToUrl && !normalizePostUrl(replyToUrl)?.includes('/status/')) return fail(`replyToUrl is not a post URL: ${replyToUrl}`);
    if (quoteUrl && !normalizePostUrl(quoteUrl)) return fail(`quoteUrl is not a post URL: ${quoteUrl}`);
    return withView(ctx, 'visible', async (view) => {
      const stopped = await navigateStep(view, buildIntentUrl(text, replyToUrl, quoteUrl), signal);
      if (stopped) return stopped;
      let composer = await view.callPreload('x_read_composer', { timeoutMs: 10_000 }, signal);
      if (!composer.success) return composer;
      let state = composer.content as { present: boolean; text: string; canSubmit: boolean };
      if (!state.text.trim()) {
        const gone = cancelled(signal);
        if (gone) return gone;
        composer = await view.callPreload('x_type_in_composer', { text: quoteUrl ? `${text} ${normalizePostUrl(quoteUrl)}` : text }, signal);
        if (!composer.success) return composer;
        state = composer.content as typeof state;
      }
      const target = replyToUrl ? `reply to ${normalizePostUrl(replyToUrl)}` : quoteUrl ? `quote of ${normalizePostUrl(quoteUrl)}` : 'new post';
      const draft = ctx.drafts.create({ text: state.text, target });
      return ok({ draftId: draft.id, preview: state.text, target });
    });
  },
});

export const submitPost = defineTool({
  name: 'x_submit_post',
  description: 'Sends the draft created by x_compose_post. In confirm mode the user must click Post in the sidebar first; in autonomous mode it posts immediately. Returns posted=true with the new post URL when available; posted=false with status cancelled_by_user means the user declined (their decision is final).',
  args: z.strictObject({ draftId: z.string() }),
  annotations: { destructiveHint: true },
  execute: async (args, ctx: XViewToolCtx, signal) => withView(ctx, 'visible', async (view) => {
    const draft = ctx.drafts.get(args.draftId);
    if (!draft) return fail('Unknown draftId; call x_compose_post first');
    const stopped = cancelled(signal);
    if (stopped) return stopped;
    const composer = await view.callPreload('x_read_composer', { timeoutMs: 3000 }, signal);
    if (!composer.success) return composer;
    const state = composer.content as { present: boolean; text: string; canSubmit: boolean };
    if (!state.canSubmit) return fail('Post button is disabled (empty draft or over the length limit)');
    if (ctx.postingMode() === 'confirm') {
      const approvedText = state.text;
      const decision = await ctx.approvals.request({
        kind: 'post',
        title: `Post this ${draft.target}?`,
        detail: approvedText,
        options: [{ id: 'post', label: 'Post' }, { id: 'cancel', label: 'Cancel' }],
      }, POST_CONFIRM_TIMEOUT_MS);
      if (decision !== 'post') {
        ctx.drafts.delete(draft.id);
        await navigateStep(view, 'https://x.com/home', signal);
        // A decline is the user's decision, not an error: say so unambiguously so the agent does not retry.
        return ok(decision === 'timeout'
          ? { posted: false, status: 'confirmation_timed_out', url: null, reason: 'The user did not respond to the confirmation within 5 minutes; the draft was discarded.' }
          : { posted: false, status: 'cancelled_by_user', url: null, reason: 'The user reviewed the draft and chose not to post it; the draft was discarded.' });
      }
      // The decision can arrive minutes later; re-read the composer so we only click Post
      // on the exact text the user approved.
      const afterApproval = cancelled(signal);
      if (afterApproval) return afterApproval;
      const recheck = await view.callPreload('x_read_composer', { timeoutMs: 3000 }, signal);
      const now = recheck.success ? (recheck.content as typeof state) : null;
      if (!now?.present || now.text !== approvedText) {
        ctx.drafts.delete(draft.id);
        return fail('Composer changed after approval; not posting');
      }
    }
    const beforeClick = cancelled(signal);
    if (beforeClick) return beforeClick;
    const clicked = await view.callPreload('x_click_post_button', {}, signal);
    if (!clicked.success) return clicked;
    ctx.drafts.delete(draft.id);
    const res = clicked.content as { url: string | null };
    return ok({ posted: true, url: res.url });
  }),
});
