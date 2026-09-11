import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { AgentStatus } from '../../shared/agent';
import type { HandleDragState } from '../../shared/ipc';
import { CLICK_HOLD_MS, decideGesture } from '../handle-drag';
import logo from '../assets/logo.png';

export type Panel = 'chat' | 'library' | 'settings' | 'history';

const Svg = (props: { d: string; title: string }) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <title>{props.title}</title>
    <path d={props.d} />
  </svg>
);
const ICON = {
  library: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6',
  plus: 'M12 5v14M5 12h14',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  chat: 'M21 12a8 8 0 0 1-8 8H8l-4 3v-3.6A8 8 0 0 1 5 5.3 8 8 0 0 1 13 4h0a8 8 0 0 1 8 8z',
  history: 'M12 8v4l3 2M21 12a9 9 0 1 1-9-9 9 9 0 0 1 9 9z',
  collapse: 'M11 17l-5-5 5-5M18 17l-5-5 5-5',
  expand: 'M13 17l5-5-5-5M6 17l5-5-5-5',
};

/**
 * The header's identity line: which model is answering, or what is wrong when none is. Clicking it
 * opens Settings, where the model is chosen; a dead agent keeps its own reconnect next to it.
 */
export function ModelPill(props: {
  status: AgentStatus;
  message?: string;
  label: string;
  canReconnect: boolean;
  onOpenSettings: () => void;
  onReconnect: () => void;
}) {
  return (
    <span className={`status status-${props.status}`}>
      <button className="pill" onClick={props.onOpenSettings} title={props.message ?? `${props.label} — open Settings`}>
        <span className="status-dot" aria-label={props.status} />
        <span className="pill-text">{props.label}</span>
      </button>
      {props.canReconnect && (
        <button className="link" onClick={props.onReconnect}>
          reconnect
        </button>
      )}
    </span>
  );
}

export function Header(props: { onNewThread: () => void; panel: Panel; onPanel: (p: Panel) => void; onCollapse: () => void }) {
  const toggle = (p: Panel) => props.onPanel(props.panel === p ? 'chat' : p);
  return (
    <header className="header">
      <div className="brand">
        <img className="brand-mark" src={logo} alt="" width={18} height={18} />
        XPilot
      </div>
      <div className="spacer" />
      <button
        className={`icon${props.panel === 'chat' ? ' icon-active' : ''}`}
        onClick={() => props.onPanel('chat')}
        title="Conversation"
        aria-label="Conversation"
      >
        <Svg d={ICON.chat} title="Conversation" />
      </button>
      <button
        className={`icon${props.panel === 'history' ? ' icon-active' : ''}`}
        onClick={() => toggle('history')}
        title="Conversations and scheduled tasks"
        aria-label="History"
      >
        <Svg d={ICON.history} title="History" />
      </button>
      <button
        className={`icon${props.panel === 'library' ? ' icon-active' : ''}`}
        onClick={() => toggle('library')}
        title="Saved PDFs"
        aria-label="Saved PDFs"
      >
        <Svg d={ICON.library} title="Saved PDFs" />
      </button>
      <button className="icon" onClick={props.onNewThread} title="New thread" aria-label="New thread">
        <Svg d={ICON.plus} title="New thread" />
      </button>
      <button
        className={`icon${props.panel === 'settings' ? ' icon-active' : ''}`}
        onClick={() => toggle('settings')}
        title="Settings"
        aria-label="Settings"
      >
        <Svg d={ICON.settings} title="Settings" />
      </button>
      <button className="icon" onClick={props.onCollapse} title="Hide sidebar (⌘\\ to show it again)" aria-label="Hide sidebar">
        <Svg d={ICON.collapse} title="Collapse sidebar" />
      </button>
    </header>
  );
}

/** A press being tracked on the handle, until it turns out to be the click or a drag. */
interface Press {
  pointerId: number;
  startX: number;
  startY: number;
  /** Where in the pill the pointer went down; the drop lands the pill's top-left that far back. */
  grabX: number;
  grabY: number;
  at: number;
  dragging: boolean;
}

/**
 * Fills the small floating view shown over x.com while the sidebar is collapsed. Clicking it opens
 * the sidebar; holding it picks it up, and then the view is the whole window (transparent but for
 * this pill) so the pointer cannot leave it and the pill follows it to wherever it is let go.
 */
export function ExpandHandle(props: { status: AgentStatus; onExpand: () => void }) {
  const [drag, setDrag] = useState<HandleDragState>({ dragging: false });
  // The press lives in a ref, not in state: the pill re-renders while it is held — the status dot
  // changes, main answers the drag — and a re-render must never drop a gesture half-way through and
  // leave a click looking like the start of a drag.
  const press = useRef<Press | null>(null);
  const hold = useRef(0);
  const frame = useRef(0);
  const at = useRef<{ x: number; y: number } | null>(null);
  const dragged = useRef(false);
  const pill = useRef<HTMLButtonElement>(null);

  useEffect(() => window.xpilot.onHandleDrag(setDrag), []);
  // Dragging, this view covers the window: everything that is not the pill has to let the page through.
  useEffect(() => {
    document.body.classList.toggle('handle-dragging', drag.dragging);
    return () => document.body.classList.remove('handle-dragging');
  }, [drag.dragging]);

  const stop = useCallback(() => {
    press.current = null;
    at.current = null;
    window.clearTimeout(hold.current);
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = 0;
  }, []);

  // Once main has stretched the view, the window is the surface the drag happens on, and the moves
  // and the release are followed there: resizing the view takes the pill's pointer capture away with
  // it, and the whole window is the pill's view now anyway.
  useEffect(() => {
    if (!drag.dragging) return;
    const held = press.current;
    if (!held) return;
    // The resize dropped the pill's pointer capture; taking it back keeps a release that happens
    // outside the window coming here rather than leaving the drag with no end.
    try {
      pill.current?.setPointerCapture(held.pointerId);
    } catch {
      /* the pointer is already gone; the listeners below are what end the drag */
    }
    const move = (e: PointerEvent) => {
      if (e.pointerId !== held.pointerId) return;
      at.current = { x: e.clientX, y: e.clientY };
      if (frame.current) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        const now = at.current;
        if (!now) return;
        setDrag((d) => (d.dragging ? { ...d, x: now.x - held.grabX, y: now.y - held.grabY } : d));
        void window.xpilot.moveHandleDrag(now.x, now.y);
      });
    };
    const drop = (e: PointerEvent) => {
      if (e.pointerId !== held.pointerId) return;
      stop();
      void window.xpilot.endHandleDrag(e.clientX, e.clientY);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      stop();
      void window.xpilot.cancelHandleDrag();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', drop);
    window.addEventListener('pointercancel', drop);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', drop);
      window.removeEventListener('pointercancel', drop);
      window.removeEventListener('keydown', escape);
    };
  }, [drag.dragging, stop]);

  const begin = (p: Press) => {
    p.dragging = true;
    dragged.current = true;
    void window.xpilot.startHandleDrag(p.grabX, p.grabY);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    const box = e.currentTarget.getBoundingClientRect();
    const p: Press = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      grabX: e.clientX - box.left,
      grabY: e.clientY - box.top,
      at: performance.now(),
      dragging: false,
    };
    press.current = p;
    dragged.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
    // A hold that never moves is a drag too, so the pill lifts under a still pointer as well.
    hold.current = window.setTimeout(() => {
      if (press.current === p && !p.dragging) begin(p);
    }, CLICK_HOLD_MS);
  };

  // The pill has the pointer until main answers, so a press can be carried past its own edges and
  // still be recognised as the start of a drag rather than a click that missed.
  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p || p.dragging || e.pointerId !== p.pointerId) return;
    if (decideGesture({ dx: e.clientX - p.startX, dy: e.clientY - p.startY, elapsedMs: performance.now() - p.at }) === 'drag') begin(p);
  };

  const onRelease = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p || e.pointerId !== p.pointerId) return;
    if (drag.dragging) return; // the drag is being followed on the window, which ends it there
    const dragging = p.dragging;
    stop();
    // A press that became a drag main has not answered yet: these coordinates are the pill's own,
    // not the window's, so there is nowhere to put it down and it goes back where it came from.
    if (dragging) void window.xpilot.cancelHandleDrag();
  };

  const style = drag.dragging ? { left: drag.x, top: drag.y, width: drag.width, height: drag.height } : undefined;
  return (
    <button
      ref={pill}
      className={`handle status-${props.status}${drag.dragging ? ' handle-floating' : ''}`}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onRelease}
      onPointerCancel={onRelease}
      onClick={() => {
        // The release that ends a drag still raises a click; only a real click opens the sidebar.
        if (dragged.current) dragged.current = false;
        else props.onExpand();
      }}
      title="Show XPilot sidebar (⌘\\) — hold to move it"
      aria-label="Show sidebar"
    >
      <span className="status-dot" />
      <span className="handle-brand">XPilot</span>
      <Svg d={ICON.expand} title="Show sidebar" />
    </button>
  );
}
