import type { ToolModule } from '../../../../shared/tools';
import type { PreloadCtx } from '../../context';
import { listPageTools, callPageTool } from './page-tools';

export const adapterTools: ToolModule<PreloadCtx>[] = [listPageTools, callPageTool];
