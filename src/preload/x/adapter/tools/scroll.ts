import { ok, type ToolModule } from '../../../../shared/tools';
import type { PreloadCtx } from '../../context';
import { sleep } from '../dom';
import { currentPageState } from './page-state';
import { scrollSpec } from './specs';

export const scroll: ToolModule<PreloadCtx> = {
  spec: scrollSpec,
  execute: async (args) => {
    const amount = typeof args.amount === 'number' ? args.amount : 800;
    window.scrollBy({ top: args.direction === 'up' ? -amount : amount, behavior: 'instant' as ScrollBehavior });
    await sleep(600);
    return ok(currentPageState());
  },
};
