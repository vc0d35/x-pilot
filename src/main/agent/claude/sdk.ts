import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';
import { MCP_SERVER, type ClaudeQueryHandle, type ClaudeQueryParams } from './query';

/**
 * Every built-in tool this version of Claude Code ships. XPilot is a browsing assistant with its
 * own tools: none of these may run, and `WebSearch` is added back to `allowedTools` only when the
 * user turned web search on. Naming them explicitly (rather than trusting `tools: []`) keeps a
 * newly added built-in from arriving enabled after a Claude Code upgrade we did not review.
 */
export const BUILT_IN_TOOLS = [
  'Agent',
  'AskUserQuestion',
  'Artifact',
  'Bash',
  'BashOutput',
  'ClaudeDesign',
  'CronCreate',
  'CronDelete',
  'CronList',
  'DesignSync',
  'Edit',
  'EnterPlanMode',
  'EnterWorktree',
  'ExitPlanMode',
  'ExitWorktree',
  'Glob',
  'Grep',
  'KillShell',
  'ListAgents',
  'ListMcpResources',
  'Mcp',
  'Monitor',
  'NotebookEdit',
  'Projects',
  'ProposeGoal',
  'ProposeSkills',
  'PushNotification',
  'Read',
  'ReadMcpResource',
  'ReadNotifications',
  'REPL',
  'RefreshMcpTools',
  'RemoteTrigger',
  'ReportFindings',
  'ScheduleWakeup',
  'SendFeedback',
  'SendMessage',
  'Skill',
  'SlashCommand',
  'Task',
  'TaskCreate',
  'TaskGet',
  'TaskList',
  'TaskOutput',
  'TaskStop',
  'TaskUpdate',
  'TodoWrite',
  'ToolSearch',
  'WebFetch',
  'WebSearch',
  'Workflow',
];

/** The SDK's own `Options` type is enormous; this is the part we set. */
type SdkTool = ReturnType<typeof tool>;

/** Runs one turn against the real Claude Agent SDK, driving the user's own `claude` binary. */
export const runSdkQuery = (params: ClaudeQueryParams): ClaudeQueryHandle => {
  const o = params.options;
  const tools: SdkTool[] = params.tools.map((t) =>
    tool(t.name, t.description, t.shape, async (args: Record<string, unknown>) => ({ ...(await t.handler(args ?? {})) })),
  );
  return query({
    prompt: params.prompt,
    options: {
      pathToClaudeCodeExecutable: o.pathToClaudeCodeExecutable,
      cwd: o.cwd,
      env: o.env,
      // Nothing from ~/.claude or the workspace: no CLAUDE.md, no hooks, no project MCP servers.
      settingSources: [],
      systemPrompt: o.systemPrompt,
      ...(o.model ? { model: o.model } : {}),
      ...(o.effort ? { effort: o.effort as 'low' | 'medium' | 'high' | 'xhigh' | 'max' } : {}),
      includePartialMessages: true,
      ...(o.resume ? { resume: o.resume } : { sessionId: o.sessionId }),
      mcpServers: { [MCP_SERVER]: createSdkMcpServer({ name: MCP_SERVER, version: '1.0.0', tools }) },
      allowedTools: [`mcp__${MCP_SERVER}__*`, ...(o.webSearch ? ['WebSearch'] : [])],
      disallowedTools: BUILT_IN_TOOLS.filter((t) => !(o.webSearch && t === 'WebSearch')),
      tools: o.webSearch ? ['WebSearch'] : [],
      permissionMode: 'dontAsk',
      abortController: o.abortController,
      stderr: o.stderr,
    },
  }) satisfies ClaudeQueryHandle;
};
