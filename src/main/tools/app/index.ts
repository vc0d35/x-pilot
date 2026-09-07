import type { ToolModule } from '../../../shared/tools';
import type { AppToolCtx } from './context';
import { searchHistory } from './search-history';
import { savePdf } from './save-pdf';
import { listLibrary, openPdf } from './library';
export const appTools: ToolModule<AppToolCtx>[] = [searchHistory, savePdf, listLibrary, openPdf];
