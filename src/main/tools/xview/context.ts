import type { Post } from '../../../shared/page';
import type { ToolResult } from '../../../shared/tools';
import type { ApprovalBroker } from '../../approvals';
import type { DraftStore } from './drafts';

export interface XViewLike {
  /**
   * False for the stub a scheduled run gets in place of the user's window. Tools that must reach
   * some logged-in view ask this rather than reading the refusal off a failed call.
   */
  isAvailable?(): boolean;
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
  /**
   * The liked-post index. `x_like_post` acts for the user - they confirmed it, or set likes to
   * autonomous - so what it likes belongs there beside the posts they clicked themselves. Page
   * scripts still cannot write a row: this is main, on the far side of the preload boundary.
   */
  likes: { recordLike(post: Post): void; recordUnlike(id: string): void };
}
