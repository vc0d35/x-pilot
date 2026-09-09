import { z } from 'zod';
import { defineTool, fail, ok } from '../../../shared/tools';
import type { AppToolCtx } from './context';

const WHAT_THEY_ARE =
  "These are the CSS selectors XPilot's page adapter uses to read x.com: every x_* tool finds posts, text, buttons and widgets through them. An override is stored in the user's profile and survives app updates; it is flagged stale when the selector XPilot ships for that key later changes, which means the built-in one has moved on and the override should be checked. When x_get_page_state reports adapterHealthy false, or a read comes back empty, or a match count here is zero, the selector for that part of the page is what needs fixing.";

export const listSelectors = defineTool({
  name: 'xpilot_list_selectors',
  description: `Lists every selector key with what it points at, the selector XPilot ships, the one in effect, and its status (default, overridden, stale). ${WHAT_THEY_ARE}`,
  args: z.strictObject({}),
  annotations: { readOnlyHint: true },
  execute: async (_args, ctx: AppToolCtx) =>
    ok({ appVersion: ctx.selectors.appVersion, path: ctx.selectors.path, selectors: ctx.selectors.list() }),
});

export const setSelector = defineTool({
  name: 'xpilot_set_selector',
  description: `Overrides the selector for one key. The selector is first run against the page the user is looking at and the number of elements it matches is returned, so check that count before and after: zero means the new selector finds nothing either. ${WHAT_THEY_ARE}`,
  args: z.strictObject({
    key: z.string().describe('One of the keys xpilot_list_selectors returns'),
    selector: z.string().describe('The CSS selector to use instead of the shipped one'),
  }),
  execute: async (args, ctx: AppToolCtx) => {
    const tried = ctx.testSelector ? await ctx.testSelector(args.selector) : null;
    if (tried && !tried.valid) return fail(`That is not a valid CSS selector: ${args.selector}`);
    const written = ctx.selectors.set(args.key, args.selector);
    if (!written.ok) return fail(`Rejected: ${written.reason}`);
    const content = {
      key: args.key,
      selector: args.selector.trim(),
      matchesOnCurrentPage: tried ? tried.count : null,
      previous: written.previous,
      status: written.status,
    };
    return tried
      ? ok(content)
      : ok(content, 'The selector was not tried against a page: there is no window to try it in from here, so the match count is unknown.');
  },
});

export const resetSelector = defineTool({
  name: 'xpilot_reset_selector',
  description: `Puts one selector back to the one XPilot ships (key), or removes every override (all: true). ${WHAT_THEY_ARE}`,
  args: z.strictObject({ key: z.string().optional(), all: z.boolean().optional() }),
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
