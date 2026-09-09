import { z } from 'zod';
import { defineTool, fail, ok } from '../../../shared/tools';
import { isActionSelectorKey } from '../../../shared/selectors';
import type { AppToolCtx } from './context';

const WHAT_THEY_ARE =
  "These are the CSS selectors XPilot's page adapter uses to read x.com: every x_* tool finds posts, text, buttons and widgets through them. An override is stored in the user's profile and survives app updates; it is flagged stale when the selector XPilot ships for that key later changes, which means the built-in one has moved on and the override should be checked. When x_get_page_state reports adapterHealthy false, or a read comes back empty, or a match count here is zero, the selector for that part of the page is what needs fixing.";

const LOCKED_EXPLANATION =
  'It drives an action rather than a read — it decides what XPilot clicks, types into, or reads back to confirm a post went out — so redirecting it would change what the app does on the account, not what it sees. Locked keys can only be changed by the user editing selectors.json by hand.';

const NO_VIEW =
  'The selector could not be tried: this run has no window to try it in. Selectors can only be changed from the interactive session, where the page the user is looking at is there to test against.';

export const listSelectors = defineTool({
  name: 'xpilot_list_selectors',
  description: `Lists every selector key with what it points at, the selector XPilot ships, the one in effect, its status (default, overridden, stale) and whether it is locked. Locked keys drive actions and cannot be changed by a tool. ${WHAT_THEY_ARE}`,
  args: z.strictObject({}),
  annotations: { readOnlyHint: true },
  execute: async (_args, ctx: AppToolCtx) =>
    ok({ appVersion: ctx.selectors.appVersion, path: ctx.selectors.path, selectors: ctx.selectors.list() }),
});

export const testSelectorTool = defineTool({
  name: 'xpilot_test_selector',
  description:
    'Runs a CSS selector against the page the user is looking at and reports whether the browser can parse it (valid) and how many elements it matches (count). Nothing is written, so use it to measure the selector in effect before changing one and the candidate after, and to try candidates against the markup x_inspect_page showed you. Only available in the interactive session, which is the one with a visible window.',
  args: z.strictObject({ selector: z.string().describe('The CSS selector to try') }),
  annotations: { readOnlyHint: true },
  execute: async (args, ctx: AppToolCtx) => {
    if (!ctx.testSelector) return fail(NO_VIEW);
    const tried = await ctx.testSelector(args.selector);
    if (!tried) return fail('The selector could not be tried: the page did not answer. Try again once the page has finished loading.');
    return ok({ selector: args.selector, valid: tried.valid, count: tried.count });
  },
});

export const setSelector = defineTool({
  name: 'xpilot_set_selector',
  description: `Overrides the selector for one read key. The selector is run against the page the user is looking at first and is only written if the browser accepts it; the number of elements it matches is returned, so measure the old one with xpilot_test_selector and compare. Keys that drive actions are locked and refused. ${WHAT_THEY_ARE}`,
  args: z.strictObject({
    key: z.string().describe('One of the keys xpilot_list_selectors returns whose locked flag is false'),
    selector: z.string().describe('The CSS selector to use instead of the shipped one'),
  }),
  annotations: { destructiveHint: true },
  execute: async (args, ctx: AppToolCtx) => {
    if (isActionSelectorKey(args.key)) return fail(`"${args.key}" cannot be changed from a tool. ${LOCKED_EXPLANATION}`);
    if (!ctx.testSelector) return fail(NO_VIEW);
    const tried = await ctx.testSelector(args.selector);
    // "Could not be tried" is a refusal, not a warning: an untested selector is written to a file
    // every X window then reads, and nothing downstream would notice it was never checked.
    if (!tried)
      return fail('The selector could not be tried against the page, so nothing was written. Try again when the page has loaded.');
    if (!tried.valid) return fail(`That is not a valid CSS selector: ${args.selector}`);
    const written = ctx.selectors.set(args.key, args.selector);
    if (!written.ok) return fail(`Rejected: ${written.reason}`);
    const content = {
      key: args.key,
      selector: args.selector.trim(),
      matchesOnCurrentPage: tried.count,
      previous: written.previous,
      status: written.status,
    };
    // Zero matches is worth writing: the element may simply not be on the page right now.
    return tried.count === 0
      ? ok(
          content,
          'It matches nothing on the page open right now, which is fine if that element is not on this page — check it on a page that has one.',
        )
      : ok(content);
  },
});

export const resetSelector = defineTool({
  name: 'xpilot_reset_selector',
  description: `Puts one selector back to the one XPilot ships (key), or removes every override (all: true). ${WHAT_THEY_ARE}`,
  args: z.strictObject({ key: z.string().optional(), all: z.boolean().optional() }),
  annotations: { destructiveHint: true },
  execute: async (args, ctx: AppToolCtx) => {
    if (args.all) {
      ctx.selectors.resetAll();
      return ok({ reset: 'all', path: ctx.selectors.path });
    }
    if (!args.key) return fail('Give the key to reset, or all: true to remove every override');
    const info = ctx.selectors.list().find((i) => i.key === args.key);
    if (!info) return fail(`There is no selector called "${args.key}"; xpilot_list_selectors has the keys`);
    const removed = ctx.selectors.reset(args.key);
    return ok({ key: args.key, selector: info.default, wasOverridden: removed, status: 'default' });
  },
});
