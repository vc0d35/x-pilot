import type { ToolModule } from '../../../shared/tools';
import type { AppToolCtx } from './context';
import { searchHistory } from './search-history';
export const appTools: ToolModule<AppToolCtx>[] = [searchHistory];
