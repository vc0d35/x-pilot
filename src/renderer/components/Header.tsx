import type { AgentStatus } from '../../shared/agent';

export type Panel = 'chat' | 'library' | 'settings';

const Svg = (props: { d: string; title: string }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><title>{props.title}</title><path d={props.d} /></svg>
);
const ICON = {
  library: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6',
  plus: 'M12 5v14M5 12h14',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  collapse: 'M9 6l6 6-6 6',
  expand: 'M15 6l-6 6 6 6',
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
      <div className="brand">XPilot</div>
      <StatusDot status={props.status} message={props.statusMessage} onReconnect={props.onReconnect} />
      <div className="spacer" />
      <button className={`icon${props.panel === 'library' ? ' icon-active' : ''}`} onClick={() => toggle('library')} title="Saved PDFs" aria-label="Saved PDFs"><Svg d={ICON.library} title="Saved PDFs" /></button>
      <button className="icon" onClick={props.onNewThread} title="New thread" aria-label="New thread"><Svg d={ICON.plus} title="New thread" /></button>
      <button className={`icon${props.panel === 'settings' ? ' icon-active' : ''}`} onClick={() => toggle('settings')} title="Settings" aria-label="Settings"><Svg d={ICON.settings} title="Settings" /></button>
      <button className="icon" onClick={props.onCollapse} title="Collapse sidebar" aria-label="Collapse sidebar"><Svg d={ICON.collapse} title="Collapse sidebar" /></button>
    </header>
  );
}

/** The slim strip shown while the sidebar is collapsed. */
export function CollapsedStrip(props: { status: AgentStatus; onExpand: () => void }) {
  return (
    <div className="strip" onClick={props.onExpand} title="Expand XPilot">
      <button className="icon" aria-label="Expand sidebar"><Svg d={ICON.expand} title="Expand sidebar" /></button>
      <span className={`status status-${props.status}`}><span className="status-dot" /></span>
      <span className="strip-brand">XPilot</span>
    </div>
  );
}
