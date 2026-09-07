import type { HistoryStore } from '../../history/store';
export interface AppToolCtx {
  history: HistoryStore;
  libraryDir(): string;
  exportPdf(url: string, outDir: string): Promise<{ path: string; title: string }>;
  openPath(path: string): Promise<string>; // resolves '' on success, error text otherwise (shell.openPath semantics)
}
