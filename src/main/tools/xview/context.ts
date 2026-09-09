import type { ToolResult } from '../../../shared/tools';
import type { ApprovalBroker } from '../../approvals';
import type { DraftStore } from './drafts';

export interface XViewLike {
  currentUrl(): string;
  /** Rejects with `Cancelled` when the signal aborts, instead of finishing the load. */
  navigate(url: string, signal?: AbortSignal): Promise<void>;
  callPreload(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult>;
}
export type ViewTarget = 'background' | 'visible';

export interface XViewToolCtx {
  /** The window the user is looking at. Only move it when the user asked to. */
  xview: XViewLike;
  /** A hidden window on the same x.com session, for reads that must not disturb the user. Created lazily. */
  background(): Promise<XViewLike>;
  allowHosts(): string[];
  approvals: ApprovalBroker;
  postingMode(): 'confirm' | 'autonomous';
  likesMode(): 'auto' | 'confirm';
  bookmarksMode(): 'auto' | 'confirm';
  drafts: DraftStore;
}
