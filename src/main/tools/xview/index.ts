import type { ToolModule } from '../../../shared/tools';
import type { XViewToolCtx } from './context';
import { navigate } from './navigate';
import { search } from './search';
import { readPost } from './read-post';
import { bookmarkPost, likePost, readBookmarks, readTimeline } from './engage';
import { composePost, submitPost } from './compose';
import { readNewsAndTrends } from './widgets';
import { openNotification, readNotifications } from './notifications';

export const xviewTools: ToolModule<XViewToolCtx>[] = [
  navigate,
  search,
  readPost,
  composePost,
  submitPost,
  likePost,
  bookmarkPost,
  readTimeline,
  readBookmarks,
  readNotifications,
  openNotification,
  readNewsAndTrends,
];
