import { fail, ok, type ToolModule } from '../../../shared/tools';
import type { XViewToolCtx } from './context';
import { normalizePostUrl } from './read-post';

const POST_CONFIRM_TIMEOUT_MS = 5 * 60 * 1000;

export function buildIntentUrl(text: string, replyToUrl?: string, quoteUrl?: string): string {
  let body = text;
  const params = new URLSearchParams();
  if (quoteUrl) body = `${body} ${normalizePostUrl(quoteUrl)}`;
  params.set('text', body);
  if (replyToUrl) params.set('in_reply_to', /\/status\/(\d+)/.exec(normalizePostUrl(replyToUrl) ?? '')![1]);
  return `https://x.com/intent/post?${params.toString().replace(/\+/g, '%20')}`;
}

export const composePost: ToolModule<XViewToolCtx> = {
  spec: {
    name: 'x_compose_post',
    description: 'Opens the composer with the given text (optionally as a reply to replyToUrl or quoting quoteUrl) and returns a draftId plus the exact preview. Does NOT post; call x_submit_post with the draftId to send.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' }, replyToUrl: { type: 'string' }, quoteUrl: { type: 'string' } }, required: ['text'], additionalProperties: false },
  },
  execute: async (args, ctx) => {
    const text = String(args.text ?? '').trim();
    if (!text) return fail('text is required');
    const replyToUrl = typeof args.replyToUrl === 'string' ? args.replyToUrl : undefined;
    const quoteUrl = typeof args.quoteUrl === 'string' ? args.quoteUrl : undefined;
    if (replyToUrl && !normalizePostUrl(replyToUrl)?.includes('/status/')) return fail(`replyToUrl is not a post URL: ${replyToUrl}`);
    if (quoteUrl && !normalizePostUrl(quoteUrl)) return fail(`quoteUrl is not a post URL: ${quoteUrl}`);
    await ctx.xview.navigate(buildIntentUrl(text, replyToUrl, quoteUrl));
    let composer = await ctx.xview.callPreload('x_read_composer', { timeoutMs: 10_000 });
    if (!composer.success) return composer;
    let state = composer.content as { present: boolean; text: string; canSubmit: boolean };
    if (!state.text.trim()) {
      composer = await ctx.xview.callPreload('x_type_in_composer', { text: quoteUrl ? `${text} ${normalizePostUrl(quoteUrl)}` : text });
      if (!composer.success) return composer;
      state = composer.content as typeof state;
    }
    const target = replyToUrl ? `reply to ${normalizePostUrl(replyToUrl)}` : quoteUrl ? `quote of ${normalizePostUrl(quoteUrl)}` : 'new post';
    const draft = ctx.drafts.create({ text: state.text, target });
    return ok({ draftId: draft.id, preview: state.text, target });
  },
};

export const submitPost: ToolModule<XViewToolCtx> = {
  spec: {
    name: 'x_submit_post',
    description: 'Sends the draft created by x_compose_post. In confirm mode the user must click Post in the sidebar first; in autonomous mode it posts immediately. Returns posted=true with the new post URL when available.',
    inputSchema: { type: 'object', properties: { draftId: { type: 'string' } }, required: ['draftId'], additionalProperties: false },
    annotations: { destructiveHint: true },
  },
  execute: async (args, ctx) => {
    const draft = ctx.drafts.get(String(args.draftId ?? ''));
    if (!draft) return fail('Unknown draftId; call x_compose_post first');
    const composer = await ctx.xview.callPreload('x_read_composer', { timeoutMs: 3000 });
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
        await ctx.xview.navigate('https://x.com/home');
        return ok({ posted: false, url: null, reason: decision === 'timeout' ? 'Confirmation timed out' : 'Cancelled by the user' });
      }
      // The decision can arrive minutes later; re-read the composer so we only click Post
      // on the exact text the user approved.
      const recheck = await ctx.xview.callPreload('x_read_composer', { timeoutMs: 3000 });
      const now = recheck.success ? (recheck.content as typeof state) : null;
      if (!now?.present || now.text !== approvedText) {
        ctx.drafts.delete(draft.id);
        return fail('Composer changed after approval; not posting');
      }
    }
    const clicked = await ctx.xview.callPreload('x_click_post_button', {});
    if (!clicked.success) return clicked;
    ctx.drafts.delete(draft.id);
    const res = clicked.content as { url: string | null };
    return ok({ posted: true, url: res.url });
  },
};
