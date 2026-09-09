import type { AgentStatus } from '../../shared/agent';
import logo from '../assets/logo.png';

export type Panel = 'chat' | 'library' | 'settings' | 'history';

const Svg = (props: { d: string; title: string }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><title>{props.title}</title><path d={props.d} /></svg>
);
const ICON = {
  library: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6',
  plus: 'M12 5v14M5 12h14',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  chat: 'M21 12a8 8 0 0 1-8 8H8l-4 3v-3.6A8 8 0 0 1 5 5.3 8 8 0 0 1 13 4h0a8 8 0 0 1 8 8z',
  history: 'M12 8v4l3 2M21 12a9 9 0 1 1-9-9 9 9 0 0 1 9 9z',
  collapse: 'M11 17l-5-5 5-5M18 17l-5-5 5-5',
  expand: 'M13 17l5-5-5-5M6 17l5-5-5-5',
};


const LABELS: Record<AgentStatus, string | null> = { ready: null, running: null, starting: 'starting', disconnected: 'disconnected', error: 'error' };

export function StatusDot(props: { status: AgentStatus; message?: string; onReconnect: () => void }) {
  const label = LABELS[props.status];
  const canReconnect = props.status === 'disconnected' || props.status === 'error';
  return (
    <span className={`status status-${props.status}`} title={props.message ?? props.status}>
      <span className="status-dot" aria-label={props.status} />
      {label && (canReconnect
        ? <button className="link" onClick={props.onReconnect}>{label} · reconnect</button>
        : <span className="status-label">{label}</span>)}
    </span>
  );
}

export function Header(props: { status: AgentStatus; statusMessage?: string; onNewThread: () => void; onReconnect: () => void; panel: Panel; onPanel: (p: Panel) => void; onCollapse: () => void }) {
  const toggle = (p: Panel) => props.onPanel(props.panel === p ? 'chat' : p);
  return (
    <header className="header">
      <div className="brand"><img className="brand-mark" src={logo} alt="" width={18} height={18} />XPilot</div>
      <StatusDot status={props.status} message={props.statusMessage} onReconnect={props.onReconnect} />
      <div className="spacer" />
      <button className={`icon${props.panel === 'chat' ? ' icon-active' : ''}`} onClick={() => props.onPanel('chat')} title="Conversation" aria-label="Conversation"><Svg d={ICON.chat} title="Conversation" /></button>
      <button className={`icon${props.panel === 'history' ? ' icon-active' : ''}`} onClick={() => toggle('history')} title="Conversations and scheduled tasks" aria-label="History"><Svg d={ICON.history} title="History" /></button>
      <button className={`icon${props.panel === 'library' ? ' icon-active' : ''}`} onClick={() => toggle('library')} title="Saved PDFs" aria-label="Saved PDFs"><Svg d={ICON.library} title="Saved PDFs" /></button>
      <button className="icon" onClick={props.onNewThread} title="New thread" aria-label="New thread"><Svg d={ICON.plus} title="New thread" /></button>
      <button className={`icon${props.panel === 'settings' ? ' icon-active' : ''}`} onClick={() => toggle('settings')} title="Settings" aria-label="Settings"><Svg d={ICON.settings} title="Settings" /></button>
      <button className="icon" onClick={props.onCollapse} title="Hide sidebar (⌘\\ to show it again)" aria-label="Hide sidebar"><Svg d={ICON.collapse} title="Collapse sidebar" /></button>
    </header>
  );
}

/** Fills the small floating view shown over x.com while the sidebar is collapsed. */
export function ExpandHandle(props: { status: AgentStatus; onExpand: () => void }) {
  return (
    <button className={`handle status-${props.status}`} onClick={props.onExpand} title="Show XPilot sidebar (⌘\\)" aria-label="Show sidebar">
      <span className="status-dot" />
      <span className="handle-brand">XPilot</span>
      <Svg d={ICON.expand} title="Show sidebar" />
    </button>
  );
}
