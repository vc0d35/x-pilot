import type { AppStore } from '../../history/store';
import type { ApprovalBroker } from '../../approvals';
import type { PageStyles } from '../../page-config/styles';
import type { SelectorOverrides } from '../../page-config/selectors';
import type { TaskManager } from '../../tasks/manager';
import type { SelectorKey } from '../../../shared/selectors';

/** What a selector does on the page the user is looking at, as the preload reports it. */
export interface SelectorTest {
  valid: boolean;
  count: number;
}

export interface AppToolCtx {
  store: AppStore;
  tasks: TaskManager;
  styles: PageStyles;
  selectors: SelectorOverrides;
  approvals: ApprovalBroker;
  /** Whether an agent-written stylesheet is confirmed by the user before it is applied. */
  stylesMode: () => 'confirm' | 'autonomous';
  /** Tries a selector on the visible page; null in a scheduled run, which has no visible view. */
  testSelector: ((selector: string) => Promise<SelectorTest | null>) | null;
  libraryDir(): string;
  exportPdf(url: string, outDir: string, selectors: Record<SelectorKey, string>): Promise<{ path: string; title: string }>;
  openPath: (path: string) => Promise<string>; // resolves '' on success, error text otherwise (shell.openPath semantics)
}
