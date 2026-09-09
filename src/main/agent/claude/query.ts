import type { z } from 'zod';
import type { McpToolResult } from './tools';

/** The in-process MCP server our tools are published under; the SDK prefixes them `mcp__xpilot__`. */
export const MCP_SERVER = 'xpilot';

/** One of our tools as the SDK wants it: a Zod shape and a handler that answers MCP content. */
export interface ClaudeTool {
  name: string;
  description: string;
  shape: Record<string, z.ZodType>;
  handler: (args: Record<string, unknown>) => Promise<McpToolResult>;
}

export interface ClaudeQueryOptions {
  pathToClaudeCodeExecutable: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  systemPrompt: string;
  model: string | null;
  effort: string | null;
  webSearch: boolean;
  /** The session to continue; null starts one, in which case `sessionId` names it. */
  resume: string | null;
  sessionId: string;
  abortController: AbortController;
  stderr: (line: string) => void;
}

export interface ClaudeQueryParams {
  prompt: string;
  tools: ClaudeTool[];
  options: ClaudeQueryOptions;
}

/** What the provider needs of the SDK's `Query`: the message stream, and Stop. */
export interface ClaudeQueryHandle extends AsyncIterable<unknown> {
  interrupt(): Promise<unknown>;
}

/**
 * Runs one turn. The whole Claude Agent SDK sits behind this one function, so the provider can be
 * tested against scripted messages without spawning anything.
 */
export type RunQuery = (params: ClaudeQueryParams) => ClaudeQueryHandle;
