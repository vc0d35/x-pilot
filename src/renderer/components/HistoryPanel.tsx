import { useEffect, useState } from 'react';
import type { Conversation, ScheduledTask } from '../../shared/sidebar-api';
import { describeSchedule } from '../../shared/schedule-format';
import { PROVIDER_LABELS, type ProviderKind } from '../../shared/agent';
import { showsProviderBadge } from '../provider-ui';

function TasksTab() {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const refresh = () => void window.xpilot.listTasks().then(setTasks);
  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 15_000);
    return () => clearInterval(iv);
  }, []);
  if (tasks.length === 0)
    return (
      <p className="hint">
        No scheduled tasks yet. Ask for one in the chat, e.g. &ldquo;every morning at 9, summarise what I liked yesterday&rdquo;. Tasks run
        only while XPilot is open.
      </p>
    );
  return (
    <div>
      {tasks.map((t) => (
        <div key={t.id} className={`task${t.enabled ? '' : ' task-off'}`}>
          <div className="task-title">
            {t.title} <span className="badge">{describeSchedule(t.schedule)}</span>
            {t.webSearch && <span className="badge">web search</span>}
            {t.visibleWindow && <span className="badge">screen</span>}
            {!t.enabled && <span className="badge">paused</span>}
          </div>
          <div className="task-prompt">{t.prompt}</div>
          <div className="conv-meta">
            {t.lastRunAt ? `last ${new Date(t.lastRunAt).toLocaleString()} · ${t.lastStatus ?? ''}` : 'never run'}
            {t.enabled && t.nextRunAt ? ` · next ${new Date(t.nextRunAt).toLocaleString()}` : ''}
            {t.lastSeenPostId ? ` · seen up to ${t.lastSeenPostId}` : ''}
          </div>
          <div className="row">
            <button onClick={() => void window.xpilot.updateTask(t.id, { enabled: !t.enabled }).then(refresh)}>
              {t.enabled ? 'Pause' : 'Resume'}
            </button>
            <button
              onClick={() => {
                void window.xpilot.runTaskNow(t.id).then(refresh);
                refresh();
              }}
            >
              Run now
            </button>
            <button
              className="danger"
              onClick={() => {
                if (confirm(`Delete task "${t.title}"?`)) void window.xpilot.deleteTask(t.id).then(refresh);
              }}
            >
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The thread of each running task's current run. Conversations come newest first, so the first one
 * a running task has is the run in flight; earlier runs of the same task are finished.
 */
export function runningRunThreads(conversations: Conversation[], tasks: ScheduledTask[]): Set<string> {
  const running = new Set(tasks.filter((t) => t.lastStatus === 'running').map((t) => t.id));
  const seen = new Set<number>();
  const threads = new Set<string>();
  for (const c of conversations) {
    if (c.kind !== 'task' || c.taskId === null || !running.has(c.taskId) || seen.has(c.taskId)) continue;
    seen.add(c.taskId);
    threads.add(c.threadId);
  }
  return threads;
}

function ConversationsTab(props: {
  currentThreadId: string | null;
  activeProvider: ProviderKind | null;
  onOpen: (threadId: string) => void;
}) {
  const [items, setItems] = useState<Conversation[]>([]);
  const [running, setRunning] = useState<Set<string>>(new Set());
  useEffect(() => {
    void Promise.all([window.xpilot.listConversations(), window.xpilot.listTasks()]).then(([conversations, tasks]) => {
      setItems(conversations);
      setRunning(runningRunThreads(conversations, tasks));
    });
  }, []);
  if (items.length === 0)
    return <p className="hint">No conversations yet. Every thread you start in the chat is saved here, newest first.</p>;
  return (
    <div>
      {items.map((c) => (
        <button
          key={c.threadId}
          className={`conv${c.threadId === props.currentThreadId ? ' conv-current' : ''}`}
          onClick={() => props.onOpen(c.threadId)}
        >
          <span className="conv-title">{c.title || (c.kind === 'task' ? 'Task run' : 'Untitled')}</span>
          <span className="conv-meta">
            {showsProviderBadge(c.provider, props.activeProvider) && <span className="badge">{PROVIDER_LABELS[c.provider]}</span>}
            {c.kind === 'task' && <span className="badge">task</span>}
            {running.has(c.threadId) && <span className="badge">running</span>}
            {new Date(c.updatedAt).toLocaleString()}
          </span>
        </button>
      ))}
    </div>
  );
}

export function HistoryPanel(props: {
  currentThreadId: string | null;
  activeProvider: ProviderKind | null;
  onOpen: (threadId: string) => void;
}) {
  const [tab, setTab] = useState<'conversations' | 'tasks'>('conversations');
  return (
    <div className="panel">
      <div className="tabs">
        <button className={tab === 'conversations' ? 'tab tab-active' : 'tab'} onClick={() => setTab('conversations')}>
          Conversations
        </button>
        <button className={tab === 'tasks' ? 'tab tab-active' : 'tab'} onClick={() => setTab('tasks')}>
          Scheduled tasks
        </button>
      </div>
      {tab === 'conversations' ? (
        <ConversationsTab currentThreadId={props.currentThreadId} activeProvider={props.activeProvider} onOpen={props.onOpen} />
      ) : (
        <TasksTab />
      )}
    </div>
  );
}
