import type { ToolModule } from '../../../shared/tools';
import type { AppToolCtx } from './context';
import { searchHistory } from './search-history';
import { savePdf } from './save-pdf';
import { listLibrary, openPdf } from './library';
import { scheduleTask, listTasks, updateTask, deleteTask } from './tasks';
export const appTools: ToolModule<AppToolCtx>[] = [
  searchHistory,
  savePdf,
  listLibrary,
  openPdf,
  scheduleTask,
  listTasks,
  updateTask,
  deleteTask,
];
