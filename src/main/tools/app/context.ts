import type { AppStore } from '../../history/store';
import type { TaskManager } from '../../tasks/manager';
export interface AppToolCtx {
  store: AppStore;
  tasks: TaskManager;
  libraryDir(): string;
  exportPdf(url: string, outDir: string): Promise<{ path: string; title: string }>;
  openPath: (path: string) => Promise<string>; // resolves '' on success, error text otherwise (shell.openPath semantics)
}
