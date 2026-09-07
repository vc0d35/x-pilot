import type { ToolResult } from '../../../shared/tools';
import type { ApprovalBroker } from '../../approvals';
import type { DraftStore } from './drafts';

export interface XViewLike {
  currentUrl(): string;
  navigate(url: string): Promise<void>;
  callPreload(name: string, args: Record<string, unknown>): Promise<ToolResult>;
}
export interface XViewToolCtx {
  xview: XViewLike;
  allowHosts(): string[];
  approvals: ApprovalBroker;
  postingMode(): 'confirm' | 'autonomous';
  drafts: DraftStore;
}
