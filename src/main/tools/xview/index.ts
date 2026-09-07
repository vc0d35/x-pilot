import type { ToolModule } from '../../../shared/tools';
import type { XViewToolCtx } from './context';
import { navigate } from './navigate';
import { search } from './search';
import { readPost } from './read-post';

export const xviewTools: ToolModule<XViewToolCtx>[] = [navigate, search, readPost];
