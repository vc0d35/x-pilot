import { describe, it, expect, vi } from 'vitest';
import { registerUserActivity } from './ipc';
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
