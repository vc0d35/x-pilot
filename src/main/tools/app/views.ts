import { z } from 'zod';
import { clampedInt, defineTool, fail, ok, type ToolResult } from '../../../shared/tools';
import { formatBytes } from '../../../shared/bytes';
import { MAX_VIEW_FILE_BYTES, VIEW_ENTRY_FILE, VIEW_FILE_EXTENSIONS, VIEW_NAME_PATTERN, VIEW_PREVIEW_MAX_MS } from '../../../shared/views';
import { VIEW_API_CONTRACT, VIEW_STARTERS } from '../../views/api';
import type { AppToolCtx } from './context';

const WHAT_IT_IS =
  'A custom view is a small web app XPilot renders over the x.com page in place of it, written by you into the profile. It has no network and no access to the X DOM: everything it shows comes from the page underneath through window.xpilotView. Call xpilot_view_api first — it is the whole contract plus two starters that already work.';

const ViewName = z
  .string()
  .regex(new RegExp(VIEW_NAME_PATTERN), 'a view name is lowercase letters, digits and dashes, up to 40 characters');

const CONFIRM_TIMEOUT_MS = VIEW_PREVIEW_MAX_MS;

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export const listViews = defineTool({
  name: 'xpilot_list_views',
  description: `Lists the custom views in the profile: name, how many files, how big, and whether the view has an ${VIEW_ENTRY_FILE} to load. Also says which one is on screen. ${WHAT_IT_IS}`,
  args: z.strictObject({}),
  annotations: { readOnlyHint: true },
  execute: async (_args, ctx: AppToolCtx) => ok({ dir: ctx.views.store.dir, active: ctx.views.active(), views: ctx.views.store.list() }),
});

export const readViewFile = defineTool({
  name: 'xpilot_read_view_file',
  description: `Returns one file of a view. Read before you rewrite: xpilot_write_view_file replaces the whole file. ${WHAT_IT_IS}`,
  args: z.strictObject({ view: ViewName, path: z.string().max(200).describe(`A path inside the view folder, e.g. ${VIEW_ENTRY_FILE}`) }),
  annotations: { readOnlyHint: true },
  execute: async (args, ctx: AppToolCtx) => {
    try {
      const content = ctx.views.store.read(args.view, args.path);
      return ok({ view: args.view, path: args.path, bytes: Buffer.byteLength(content), content });
    } catch (err) {
      return fail(message(err));
    }
  },
});

export const writeViewFile = defineTool({
  name: 'xpilot_write_view_file',
  description: `Writes one file of a view, creating the view on the first write, and replacing the whole file. The entry point is ${VIEW_ENTRY_FILE}; a view that is on screen reloads as soon as a file changes. Allowed: ${VIEW_FILE_EXTENSIONS.join(', ')}, up to ${MAX_VIEW_FILE_BYTES / 1024} KB each. Inline <script> is refused by the view's content policy, so put JavaScript in its own file. ${WHAT_IT_IS}`,
  args: z.strictObject({
    view: ViewName,
    path: z.string().max(200).describe(`A path inside the view folder, e.g. ${VIEW_ENTRY_FILE} or app.js`),
    content: z.string(),
  }),
  execute: async (args, ctx: AppToolCtx) => {
    try {
      const { bytes } = ctx.views.store.write(args.view, args.path, args.content);
      return ok({ status: 'written', view: args.view, path: args.path, bytes });
    } catch (err) {
      return fail(message(err));
    }
  },
});

export const deleteView = defineTool({
  name: 'xpilot_delete_view',
  description: `Deletes a view and every file in it. The user confirms first; a view they are looking at is taken off the screen with it. ${WHAT_IT_IS}`,
  args: z.strictObject({ view: ViewName }),
  annotations: { destructiveHint: true },
  execute: async (args, ctx: AppToolCtx) => {
    if (!ctx.views.store.exists(args.view)) return fail(`There is no view called ${args.view}`);
    const summary = ctx.views.store.list().find((v) => v.name === args.view);
    const { decision } = await ctx.approvals.request(
      {
        kind: 'fileChange',
        title: 'Delete this view?',
        summary: summary ? `${args.view}: ${summary.files} files, ${formatBytes(summary.bytes)}` : args.view,
        detail: ctx.views.store.files(args.view).join('\n'),
        options: [
          { id: 'delete', label: 'Delete' },
          { id: 'cancel', label: 'Keep it' },
        ],
      },
      CONFIRM_TIMEOUT_MS,
    );
    if (decision !== 'delete')
      return ok(
        decision === 'timeout'
          ? { status: 'confirmation_timed_out', reason: 'The user did not answer within 10 minutes; the view was left alone.' }
          : { status: 'cancelled_by_user', reason: 'The user chose to keep the view; their decision is final.' },
      );
    if (ctx.views.active() === args.view) {
      ctx.views.hide();
      ctx.views.persist(null);
    }
    ctx.views.store.delete(args.view);
    return ok({ status: 'deleted', view: args.view });
  },
});

/**
 * Showing a view is the same shape as writing page styles: it replaces what the user is looking at,
 * so unless they set views to autonomous they see it first and decide. The preview comes off however
 * this ends — kept, adjusted, reverted, timed out, or the turn dying mid-question.
 */
export const activateView = defineTool({
  name: 'xpilot_activate_view',
  description: `Shows a view in place of the x.com page and remembers it for the next start. Unless the user has set views to autonomous they see it on screen first and decide: status kept means it stays, adjust_requested carries a note saying what to change (fix it and activate again), cancelled_by_user means they went back to X. ${WHAT_IT_IS}`,
  args: z.strictObject({ view: ViewName }),
  execute: async (args, ctx: AppToolCtx): Promise<ToolResult> => {
    if (!ctx.views.store.exists(args.view)) return fail(`There is no view called ${args.view}`);
    if (!ctx.views.store.hasIndex(args.view)) return fail(`${args.view} has no ${VIEW_ENTRY_FILE}; write one before activating it`);
    const failure = await ctx.views.show(args.view);
    if (failure) return fail(`${args.view} could not be shown: ${failure}`);
    if (ctx.views.mode() !== 'confirm') {
      ctx.views.persist(args.view);
      return ok({ status: 'kept', view: args.view });
    }
    // Until the card is answered the view is on screen to be looked at: the bridge gives it the
    // reads and the feeds, and neither the drivers nor the writes.
    ctx.views.preview(true);
    try {
      const { decision, note } = await ctx.approvals.request(
        {
          kind: 'post',
          title: 'Keep this view?',
          summary: `${args.view} is on screen in place of x.com`,
          detail: ctx.views.store.files(args.view).join('\n'),
          options: [
            { id: 'keep', label: 'Keep' },
            { id: 'adjust', label: 'Adjust…', note: true },
            { id: 'revert', label: 'Revert' },
          ],
        },
        CONFIRM_TIMEOUT_MS,
      );
      if (decision === 'keep') {
        ctx.views.preview(false);
        ctx.views.persist(args.view);
        return ok({ status: 'kept', view: args.view });
      }
      ctx.views.hide();
      if (decision === 'adjust')
        return ok({
          status: 'adjust_requested',
          view: args.view,
          note: note ?? '',
          reason: 'The user saw the view and wants a change; apply the note, write the files again and activate it again.',
        });
      return ok(
        decision === 'timeout'
          ? {
              status: 'confirmation_timed_out',
              reason: 'The user did not answer within 10 minutes; the view was taken off the screen and nothing was remembered.',
            }
          : {
              status: 'cancelled_by_user',
              reason: 'The user saw the view and chose to go back to X; their decision is final.',
            },
      );
    } catch (err) {
      ctx.views.hide();
      return fail(message(err));
    }
  },
});

export const deactivateView = defineTool({
  name: 'xpilot_deactivate_view',
  description: 'Takes the custom view off the screen and puts the user back on the x.com page. Does nothing if no view is showing.',
  args: z.strictObject({}),
  execute: async (_args, ctx: AppToolCtx) => {
    const was = ctx.views.active();
    ctx.views.hide();
    ctx.views.persist(null);
    return ok({ status: 'deactivated', wasShowing: was });
  },
});

export const viewConsole = defineTool({
  name: 'xpilot_view_console',
  description:
    'Returns the console messages, preload failures and renderer crashes a view produced, newest last. This is how you debug a view: it has no devtools of its own. Omit `view` for every view.',
  args: z.strictObject({
    view: ViewName.optional().describe('The view to read; every view when omitted'),
    limit: clampedInt(1, 200, 'How many entries to return', 50),
  }),
  annotations: { readOnlyHint: true },
  execute: async (args, ctx: AppToolCtx) => ok({ view: args.view ?? null, entries: ctx.views.logs(args.view, args.limit) }),
});

export const viewInspect = defineTool({
  name: 'xpilot_view_inspect',
  description:
    'Returns the markup the view on screen actually rendered for a CSS selector: tag, identifying attributes and truncated outer HTML. Use it to check that a view drew what you meant it to.',
  args: z.strictObject({
    selector: z.string().max(500).default('body').describe('The CSS selector to look at'),
    limit: clampedInt(1, 20, 'How many matches to return', 5),
  }),
  annotations: { readOnlyHint: true },
  execute: async (args, ctx: AppToolCtx) => {
    const result = await ctx.views.inspect(args.selector, args.limit);
    if (result === null) return fail('No custom view is on screen; activate one first.');
    if ('error' in result) return fail(result.error);
    return ok(result);
  },
});

export const viewApi = defineTool({
  name: 'xpilot_view_api',
  description:
    'Returns the contract a custom view is written against — what window.xpilotView offers, which tools it may call, what its page is allowed to load — plus two starter views that already work. Read this before writing or changing a view.',
  args: z.strictObject({}),
  annotations: { readOnlyHint: true },
  execute: async (_args, _ctx: AppToolCtx) => ok({ contract: VIEW_API_CONTRACT, starters: VIEW_STARTERS }),
});

export const viewTools = [
  listViews,
  readViewFile,
  writeViewFile,
  deleteView,
  activateView,
  deactivateView,
  viewConsole,
  viewInspect,
  viewApi,
];
