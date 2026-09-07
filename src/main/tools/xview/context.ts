import type { ToolResult } from '../../../shared/tools';

export interface XViewLike {
  currentUrl(): string;
  navigate(url: string): Promise<void>;
  callPreload(name: string, args: Record<string, unknown>): Promise<ToolResult>;
}
export interface XViewToolCtx { xview: XViewLike; allowHosts(): string[] }
