import { describe, it, expect, vi } from 'vitest';
import { createHandleDrag, registerUserActivity, shouldExpandSidebar } from './ipc';
import { IPC, type HandleDragState } from '../shared/ipc';
import { HANDLE_HEIGHT, HANDLE_INSET, HANDLE_WIDTH, type HandlePosition } from './layout';

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

/** A window the size of the default one, with the handle where `computeLayout` would put it. */
function fakeWindow(size = { width: 1500, height: 950 }) {
  const at = { x: size.width - HANDLE_WIDTH - HANDLE_INSET - 15, y: HANDLE_INSET };
  const dropped: (HandlePosition | null)[] = [];
  const states: HandleDragState[] = [];
  const saved: (HandlePosition | null)[] = [];
  let stretched = false;
  let collapsed = true;
  const drag = createHandleDrag({
    handle: {
      beginDrag: () => {
        if (!collapsed) return null;
        stretched = true;
        return { ...at, width: HANDLE_WIDTH, height: HANDLE_HEIGHT };
      },
      endDrag: (position) => {
        stretched = false;
        dropped.push(position);
      },
      contentSize: () => size,
    },
    saveHandle: (position) => saved.push(position),
    send: (state) => states.push(state),
  });
  return { drag, at, dropped, saved, states, expand: () => (collapsed = false), isStretched: () => stretched };
}

describe('createHandleDrag', () => {
  it("stretches the handle's view over the window and says where the pill was", () => {
    const w = fakeWindow();
    w.drag.start(20, 16);
    expect(w.isStretched()).toBe(true);
    expect(w.states).toEqual([{ dragging: true, ...w.at, width: HANDLE_WIDTH, height: HANDLE_HEIGHT }]);
  });

  it('drops the handle at the pointer minus where in the pill it was grabbed, and remembers it', () => {
    const w = fakeWindow();
    w.drag.start(20, 16);
    w.drag.move(500, 400);
    w.drag.end({ x: 520, y: 416 });
    expect(w.saved).toEqual([{ x: 500, y: 400 }]);
    expect(w.dropped).toEqual([{ x: 500, y: 400 }]);
    expect(w.isStretched()).toBe(false);
    expect(w.states.at(-1)).toEqual({ dragging: false });
  });

  it('clamps a drop that hangs over an edge back inside the window before it is stored', () => {
    const w = fakeWindow();
    w.drag.start(50, 20);
    w.drag.end({ x: 1495, y: 948 });
    expect(w.saved).toEqual([{ x: 1500 - HANDLE_WIDTH - HANDLE_INSET, y: 950 - HANDLE_HEIGHT - HANDLE_INSET }]);
    expect(w.dropped).toEqual(w.saved);
  });

  it('leaves the handle where it was, and stores nothing, when the drag is cancelled', () => {
    const w = fakeWindow();
    w.drag.start(20, 16);
    w.drag.move(500, 400);
    w.drag.end(null);
    expect(w.saved).toEqual([]);
    expect(w.dropped).toEqual([null]);
    expect(w.isStretched()).toBe(false);
  });

  it('lands an abandoned drag where the pointer last was, and does nothing without one', () => {
    const w = fakeWindow();
    w.drag.start(20, 16);
    w.drag.move(600, 500);
    w.drag.abandon();
    expect(w.saved).toEqual([{ x: 580, y: 484 }]);
    const idle = fakeWindow();
    idle.drag.abandon();
    idle.drag.end({ x: 10, y: 10 });
    idle.drag.move(10, 10);
    expect(idle.saved).toEqual([]);
    expect(idle.states).toEqual([]);
  });

  it('ignores a press on a sidebar that is not collapsed', () => {
    const open = fakeWindow();
    open.expand();
    open.drag.start(20, 16);
    expect(open.states).toEqual([]);
  });

  it('drops a press that was never released rather than refusing the next one', () => {
    const w = fakeWindow();
    w.drag.start(20, 16);
    w.drag.start(4, 4);
    w.drag.end({ x: 300, y: 250 });
    expect(w.saved).toEqual([{ x: 296, y: 246 }]);
    expect(w.states.map((s) => s.dragging)).toEqual([true, false, true, false]);
  });
});
