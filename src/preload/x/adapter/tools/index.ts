import type { ToolModule } from '../../../../shared/tools';
import type { PreloadCtx } from '../../context';
import { pageState } from './page-state';
import { readVisiblePosts } from './read-visible';
import { readCurrentPost } from './read-current-post';
import { scroll } from './scroll';
import { likeInPage, selectHomeTab } from './engage';
import { readComposer, typeInComposer, clickPostButton } from './composer';
import { readWidgets, showNewPosts } from './widgets';

export const adapterTools: ToolModule<PreloadCtx>[] = [pageState, readVisiblePosts, readCurrentPost, scroll, readComposer, typeInComposer, clickPostButton, likeInPage, selectHomeTab, readWidgets, showNewPosts];
