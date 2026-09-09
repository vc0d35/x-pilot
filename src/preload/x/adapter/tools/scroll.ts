import { defineTool, ok } from '../../../../shared/tools';
import type { PreloadCtx } from '../../context';
import { sleep } from '../dom';
import { currentPageState } from './page-state';
import { scrollDef } from './specs';

export const scroll = defineTool({
  ...scrollDef,
  execute: async (args, _ctx: PreloadCtx) => {
    const amount = args.amount ?? 800;
    window.scrollBy({ top: args.direction === 'up' ? -amount : amount, behavior: 'instant' as ScrollBehavior });
    await sleep(600);
    return ok(currentPageState());
  },
});
