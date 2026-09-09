import { describe, it, expect } from 'vitest';
import { IPC } from './ipc';

describe('IPC channels', () => {
  it("names the conversation-event channel main pushes a watched run's transcript on", () => {
    expect(IPC.conversationEvent).toBe('conversation:event');
  });

  it("names the channels a scheduled run on the user's window needs", () => {
    expect(IPC.userActive).toBe('user:active');
    expect(IPC.tasksStopRun).toBe('tasks:stopRun');
  });

  it('keeps every channel name distinct, so no two handlers share one', () => {
    const names = Object.values(IPC);
    expect(new Set(names).size).toBe(names.length);
  });
});
