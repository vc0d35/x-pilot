import type { ToolModule } from '../../../shared/tools';
import type { AppToolCtx } from './context';
import { searchHistory } from './search-history';
import { savePdf } from './save-pdf';
import { listLibrary, openPdf } from './library';
import { scheduleTask, listTasks, updateTask, deleteTask } from './tasks';
import { readPageStyles, writePageStyles, resetPageStyles } from './styles';
import { listSelectors, testSelectorTool, setSelector, resetSelector } from './selectors';
export const appTools: ToolModule<AppToolCtx>[] = [
  searchHistory,
  savePdf,
  listLibrary,
  openPdf,
  scheduleTask,
  listTasks,
  updateTask,
  deleteTask,
  readPageStyles,
  writePageStyles,
  resetPageStyles,
  listSelectors,
  testSelectorTool,
  setSelector,
  resetSelector,
];
