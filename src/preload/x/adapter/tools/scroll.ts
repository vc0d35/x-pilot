import { ok, type ToolModule } from '../../../../shared/tools';
import type { PreloadCtx } from '../../context';
import { sleep } from '../dom';
import { currentPageState } from './page-state';

export const scroll: ToolModule<PreloadCtx> = {
  spec: {
    name: 'x_scroll',
    description: 'Scrolls the window the user is looking at to load more content (e.g. to roll through the timeline when asked). direction: "down" (default) or "up"; amount in pixels (default 800).',
    inputSchema: { type: 'object', properties: { direction: { type: 'string', enum: ['down', 'up'] }, amount: { type: 'integer', minimum: 100, maximum: 5000 } }, additionalProperties: false },
  },
  execute: async (args) => {
    const amount = typeof args.amount === 'number' ? args.amount : 800;
    window.scrollBy({ top: args.direction === 'up' ? -amount : amount, behavior: 'instant' as ScrollBehavior });
    await sleep(600);
    return ok(currentPageState());
  },
};
