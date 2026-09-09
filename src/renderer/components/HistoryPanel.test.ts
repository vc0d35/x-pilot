import { describe, it, expect } from 'vitest';
import { runningRunThreads } from './HistoryPanel';
import type { Conversation, ScheduledTask } from '../../shared/sidebar-api';

const conv = (threadId: string, kind: Conversation['kind'], taskId: number | null): Conversation => ({
  threadId,
  title: threadId,
  kind,
  taskId,
  createdAt: '',
  updatedAt: '',
  toolsHash: null,
});
const task = (id: number, lastStatus: ScheduledTask['lastStatus']): ScheduledTask => ({
  id,
  title: `t${id}`,
  prompt: 'p',
  schedule: { every: '1h' },
  threadMode: 'resume',
  threadId: null,
  enabled: true,
  createdAt: '',
  lastRunAt: null,
  lastStatus,
  nextRunAt: null,
  webSearch: false,
  lastSeenPostId: null,
  visibleWindow: false,
});

describe('runningRunThreads', () => {
  it('marks only the newest run of each task that is running now', () => {
    // Newest first, as listConversations returns them.
    const conversations = [conv('chat-1', 'chat', null), conv('run-2b', 'task', 2), conv('run-2a', 'task', 2), conv('run-1', 'task', 1)];
    const threads = runningRunThreads(conversations, [task(1, 'completed'), task(2, 'running')]);
    expect([...threads]).toEqual(['run-2b']);
  });

  it('marks nothing when no task is running', () => {
    expect(runningRunThreads([conv('run-1', 'task', 1)], [task(1, 'failed')]).size).toBe(0);
  });
});
