import type { AgentStatus } from '../../shared/agent';

export type Panel = 'chat' | 'library' | 'settings';

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
      <button className={`icon${props.panel === 'library' ? ' icon-active' : ''}`} onClick={() => toggle('library')} title="Saved PDFs">PDFs</button>
      <button className="icon" onClick={props.onNewThread} title="New thread" aria-label="New thread">+</button>
      <button className={`icon${props.panel === 'settings' ? ' icon-active' : ''}`} onClick={() => toggle('settings')} title="Settings" aria-label="Settings">⚙</button>
      <button className="icon" onClick={props.onCollapse} title="Collapse sidebar" aria-label="Collapse sidebar">›</button>
    </header>
  );
}

/** The slim strip shown while the sidebar is collapsed. */
export function CollapsedStrip(props: { status: AgentStatus; onExpand: () => void }) {
  return (
    <div className="strip" onClick={props.onExpand} title="Expand XPilot">
      <button className="icon" aria-label="Expand sidebar">‹</button>
      <span className={`status status-${props.status}`}><span className="status-dot" /></span>
      <span className="strip-brand">XPilot</span>
    </div>
  );
}
