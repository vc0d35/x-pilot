import { PROVIDER_LABELS, type ProviderKind } from '../../shared/agent';
import type { ModelInfo } from '../../shared/sidebar-api';
import type { ToolResult } from '../../shared/tools';
import type { ApprovalBroker } from '../approvals';
import type { UserInputBroker } from '../user-input';
import { CodexProvider } from './codex/provider';
import { ClaudeProvider } from './claude/provider';
import { CLAUDE_MODELS } from './claude/models';
import { runSdkQuery } from './claude/sdk';
import type { AgentProvider } from './provider';

export { PROVIDER_LABELS };
export type { ProviderKind };

/** Everything either provider might need; each takes what it uses. */
export interface ProviderDeps {
  callTool: (name: string, args: Record<string, unknown>, signal?: AbortSignal) => Promise<ToolResult>;
  approvals: ApprovalBroker;
  /** Clarifying questions from the agent; Codex only, and optional there. */
  userInput?: UserInputBroker;
  clientVersion?: string;
}

export function createProvider(kind: ProviderKind, deps: ProviderDeps): AgentProvider {
  if (kind === 'claude') return new ClaudeProvider({ callTool: deps.callTool, runQuery: runSdkQuery });
  return new CodexProvider(deps);
}

/**
 * What a provider offers without being started. Codex only knows its models once its app-server is
 * running, so the caller supplies whatever it last heard; Claude's list is static.
 */
export function staticModels(kind: ProviderKind): ModelInfo[] {
  return kind === 'claude' ? CLAUDE_MODELS : [];
}
