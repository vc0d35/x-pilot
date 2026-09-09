import { defineTool, ok } from '../../../../shared/tools';
import type { PreloadCtx } from '../../context';
import { testSelectorDef } from './specs';

/** Internal: what a selector does on the page right now, so an override can be checked before it is written. */
export const testSelector = defineTool({
  ...testSelectorDef,
  execute: async (args, _ctx: PreloadCtx) => {
    try {
      return ok({ valid: true, count: document.querySelectorAll(args.selector).length });
    } catch {
      // querySelectorAll throws on a selector the browser cannot parse; that is the answer, not a failure.
      return ok({ valid: false, count: 0 });
    }
  },
});
