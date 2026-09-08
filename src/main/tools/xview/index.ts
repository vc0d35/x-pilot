import type { ToolModule } from '../../../shared/tools';
import type { XViewToolCtx } from './context';
import { navigate } from './navigate';
import { search } from './search';
import { readPost } from './read-post';
import { likePost, readTimeline } from './engage';
import { composePost, submitPost } from './compose';

export const xviewTools: ToolModule<XViewToolCtx>[] = [navigate, search, readPost, composePost, submitPost, likePost, readTimeline];
