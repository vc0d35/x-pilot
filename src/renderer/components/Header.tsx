import type { AgentStatus } from '../../shared/agent';
import { confirmPostingMode } from '../../shared/settings';

export type Panel = 'chat' | 'library' | 'settings';

export function Header(props: { status: AgentStatus; statusMessage?: string; running: boolean; onStop: () => void; onNewThread: () => void; onReconnect: () => void; postingMode: 'confirm' | 'autonomous'; onTogglePosting: () => void; panel: Panel; onPanel: (p: Panel) => void }) {
  return (
    <header className="header">
      <div className="brand">X Pilot</div>
      <div className={`status status-${props.status}`} title={props.statusMessage ?? ''}>{props.status}</div>
      <nav className="tabs">
        <button className={props.panel === 'chat' ? 'tab tab-active' : 'tab'} onClick={() => props.onPanel('chat')}>Chat</button>
        <button className={props.panel === 'library' ? 'tab tab-active' : 'tab'} onClick={() => props.onPanel('library')}>Library</button>
        <button className={props.panel === 'settings' ? 'tab tab-active' : 'tab'} onClick={() => props.onPanel('settings')}>Settings</button>
      </nav>
      <div className="spacer" />
      <button className={`toggle toggle-${props.postingMode}`} onClick={() => { if (confirmPostingMode(props.postingMode === 'confirm' ? 'autonomous' : 'confirm', confirm)) props.onTogglePosting(); }} title="Click to switch posting mode">
        {props.postingMode === 'confirm' ? 'Posts: confirm' : 'Posts: autonomous ⚠︎'}
      </button>
      {props.running && <button onClick={props.onStop}>Stop</button>}
      <button onClick={props.onNewThread}>New thread</button>
      {(props.status === 'disconnected' || props.status === 'error') && <button onClick={props.onReconnect}>Reconnect</button>}
      {props.status === 'error' && <div className="banner">{props.statusMessage}</div>}
    </header>
  );
}
