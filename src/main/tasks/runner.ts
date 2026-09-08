import type { AgentEvent } from '../../shared/agent';
import type { ScheduledTask } from '../../shared/sidebar-api';
import type { Settings } from '../../shared/settings';
import type { ToolSpec } from '../../shared/tools';
import type { AgentProvider } from '../agent/provider';
import { toolsFingerprint } from '../agent/controller';
import type { HistoryStore } from '../history/store';
import { describeSchedule } from './schedule';
import type { RunStatus } from './manager';

const RECORDED = new Set<AgentEvent['type']>(['user.message', 'message.completed', 'thinking.completed', 'tool.started', 'tool.completed', 'turn.completed']);

export function buildRunPrompt(task: ScheduledTask, lastRunAt: string | null): string {
  const when = lastRunAt ? `last run ${lastRunAt}` : 'first run';
  return `Scheduled task "${task.title}" (${describeSchedule(task.schedule)}), ${when}. Do the task below without asking questions; the user is not watching.\n\n${task.prompt}`;
}

/** Executes one task run on its own agent provider (a dedicated Codex process), recording a task conversation. */
export class TaskRunner {
  lastThreadId: string | null = null;

  constructor(private readonly deps: {
    createProvider: () => AgentProvider;
    tools: () => ToolSpec[];
    settings: () => Settings['agent']['codex'];
    workspaceDir: string;
    store: HistoryStore;
    timeoutMs?: number;
    log?: (m: string) => void;
  }) {}

  async run(task: ScheduledTask): Promise<RunStatus> {
    const provider = this.deps.createProvider();
    const tools = this.deps.tools();
    let threadId: string | null = null;
    const done = new Promise<RunStatus>((resolve) => {
      provider.onEvent((e) => {
        if (threadId && RECORDED.has(e.type)) this.deps.store.appendEvent(threadId, e);
        if (e.type === 'turn.completed') resolve(e.status === 'completed' ? 'completed' : e.status === 'interrupted' ? 'interrupted' : 'failed');
        if (e.type === 'status' && (e.status === 'disconnected' || e.status === 'error')) resolve('failed');
      });
    });
    try {
      const started = await provider.start({ tools, settings: this.deps.settings(), threadId: task.threadMode === 'resume' ? task.threadId : null, workspaceDir: this.deps.workspaceDir });
      threadId = started.threadId;
      this.lastThreadId = threadId;
      this.deps.store.upsertConversation({ threadId, kind: 'task', taskId: task.id, toolsHash: toolsFingerprint(tools) });
      await provider.send(buildRunPrompt(task, task.lastRunAt), null);
      const timeout = new Promise<RunStatus>((resolve) => setTimeout(() => resolve('interrupted'), this.deps.timeoutMs ?? 10 * 60_000));
      const status = await Promise.race([done, timeout]);
      if (status === 'interrupted') await provider.interrupt().catch(() => undefined);
      return status;
    } catch (err) {
      this.deps.log?.(`[xpilot] task ${task.id} failed: ${err instanceof Error ? err.message : String(err)}`);
      return 'failed';
    } finally {
      await provider.stop().catch(() => undefined);
    }
  }
}
