import { describe, it, expect, vi } from 'vitest';
import { registerUserActivity, shouldExpandSidebar } from './ipc';
import { IPC } from '../shared/ipc';

type Listener = (event: { sender: { id: number } }, payload: unknown) => void;

function fakeIpc() {
  const listeners = new Map<string, Listener>();
  return {
    ipc: { on: (channel: string, listener: Listener) => listeners.set(channel, listener) },
    send: (channel: string, senderId: number) => listeners.get(channel)?.({ sender: { id: senderId } }, undefined),
  };
}

describe('registerUserActivity', () => {
  it('notes activity from the visible X view and ignores every other sender', () => {
    const { ipc, send } = fakeIpc();
    const onActivity = vi.fn();
    registerUserActivity({ ipc, xContentsId: 7, onActivity });
    send(IPC.userActive, 7);
    expect(onActivity).toHaveBeenCalledTimes(1);
    send(IPC.userActive, 8);
    expect(onActivity).toHaveBeenCalledTimes(1);
  });
});

describe('shouldExpandSidebar', () => {
  const request = { id: 'a1', origin: { kind: 'agent' as const }, kind: 'post' as const, title: 'Post?', detail: 'hi', options: [] };

  it('brings a collapsed sidebar back out for a card the user has to answer', () => {
    expect(shouldExpandSidebar({ type: 'approval.requested', request }, true)).toBe(true);
  });

  it('leaves an expanded sidebar alone', () => {
    expect(shouldExpandSidebar({ type: 'approval.requested', request }, false)).toBe(false);
  });

  it('does not expand for anything else, including a card being resolved', () => {
    expect(shouldExpandSidebar({ type: 'approval.resolved', id: 'a1', decision: 'post' }, true)).toBe(false);
    expect(shouldExpandSidebar({ type: 'tool.started', itemId: 't1', name: 'view:x_like_post', args: {} }, true)).toBe(false);
  });
});
