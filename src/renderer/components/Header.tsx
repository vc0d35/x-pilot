import type { AgentStatus } from '../../shared/agent';

export function Header(props: { status: AgentStatus; statusMessage?: string; running: boolean; onStop: () => void; onNewThread: () => void; postingMode: 'confirm' | 'autonomous'; onTogglePosting: () => void }) {
  return (
    <header className="header">
      <div className="brand">X Pilot</div>
      <div className={`status status-${props.status}`} title={props.statusMessage ?? ''}>{props.status}</div>
      <div className="spacer" />
      <button className={`toggle toggle-${props.postingMode}`} onClick={props.onTogglePosting} title="Click to switch posting mode">
        {props.postingMode === 'confirm' ? 'Posts: confirm' : 'Posts: autonomous ⚠︎'}
      </button>
      {props.running && <button onClick={props.onStop}>Stop</button>}
      <button onClick={props.onNewThread}>New thread</button>
      {props.status === 'error' && <div className="banner">{props.statusMessage}</div>}
    </header>
  );
}
