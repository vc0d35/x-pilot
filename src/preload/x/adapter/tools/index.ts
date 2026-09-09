import { fail, runTool, type ToolModule, type ToolResult } from '../../../../shared/tools';
import type { PreloadCtx } from '../../context';
import { pageState } from './page-state';
import { readVisiblePosts } from './read-visible';
import { readCurrentPost } from './read-current-post';
import { scroll } from './scroll';
import { bookmarkInPage, likeInPage, selectHomeTab } from './engage';
import { readComposer, typeInComposer, clickPostButton } from './composer';
import { readWidgets, showNewPosts } from './widgets';
import { inspectPage } from './inspect-page';
import { testSelector } from './test-selector';

export const adapterTools: ToolModule<PreloadCtx>[] = [
  pageState,
  readVisiblePosts,
  readCurrentPost,
  scroll,
  readComposer,
  typeInComposer,
  clickPostButton,
  likeInPage,
  bookmarkInPage,
  selectHomeTab,
  readWidgets,
  showNewPosts,
  inspectPage,
  testSelector,
];

const byName = new Map(adapterTools.map((t) => [t.spec.name, t]));

/**
 * The preload's half of the tool layer: the same argument parsing main does in `AppToolSource`,
 * so a bad call from the model is a failure the agent can read rather than a thrown exception or a
 * coerced value.
 */
export async function runAdapterTool(name: string, rawArgs: unknown, ctx: PreloadCtx, signal?: AbortSignal): Promise<ToolResult> {
  const tool = byName.get(name);
  if (!tool) return fail(`Unknown tool in preload: ${name}`);
  try {
    return await runTool(tool, rawArgs, ctx, signal);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}
