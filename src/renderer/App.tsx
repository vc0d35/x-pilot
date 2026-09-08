import { useEffect, useReducer, useState } from 'react';
import { reduce, initialState } from './state';
import { Header, ExpandHandle, type Panel } from './components/Header';
import { EntryList } from './components/EntryList';
import { Composer } from './components/Composer';
import { LibraryPanel } from './components/LibraryPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { HistoryPanel } from './components/HistoryPanel';
import type { PageContext } from '../shared/page';
import type { Settings } from '../shared/settings';

export function App() {
  const [state, dispatch] = useReducer(reduce, initialState);
  const [focus, setFocus] = useState<PageContext | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [panel, setPanel] = useState<Panel>('chat');
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => window.xpilot.onSidebarCollapsed(setCollapsed), []);

  useEffect(() => window.xpilot.onEvent(dispatch), []);
  useEffect(() => window.xpilot.onFocus(setFocus), []);
  useEffect(() => { void window.xpilot.getSettings().then(setSettings); return window.xpilot.onSettings(setSettings); }, []);

  const adapterBroken = state.entries.some((en) => en.kind === 'tool' && en.call.status === 'done' && (en.call.output ?? '').includes('"adapterHealthy":false'));

  if (collapsed) return <ExpandHandle status={state.status} onExpand={() => void window.xpilot.setSidebarCollapsed(false)} />;

  return (
    <div className="app">
      <Header status={state.status} statusMessage={state.statusMessage}
        onNewThread={() => { dispatch({ type: 'reset' }); void window.xpilot.newThread(); }}
        onReconnect={() => void window.xpilot.reconnect()}
        panel={panel} onPanel={setPanel} onCollapse={() => void window.xpilot.setSidebarCollapsed(true)} />
      {adapterBroken && <div className="banner">X changed its layout; some tools may fail until the adapter is updated.</div>}
      {settings?.posting.mode === 'autonomous' && <div className="banner">Autonomous posting is on: the agent can post without confirmation.</div>}
      {panel === 'history' ? (
        <HistoryPanel currentThreadId={state.threadId} onOpen={(threadId) => {
          dispatch({ type: 'reset' });
          setPanel('chat');
          void window.xpilot.openConversation(threadId).then((events) => { for (const e of events) dispatch(e); });
        }} />
      ) : panel === 'library' ? (
        <LibraryPanel />
      ) : panel === 'settings' ? (
        settings && <SettingsPanel settings={settings} />
      ) : (
        <>
          <EntryList entries={state.entries} activity={state.activity} onResolve={(id, d) => void window.xpilot.resolveApproval(id, d)} />
          <Composer disabled={state.status !== 'ready' && state.status !== 'running'} running={state.running} focus={focus} onStop={() => void window.xpilot.interrupt()}
            onSend={(text, ctx) => window.xpilot.send(text, ctx).then(() => true, (err) => {
              dispatch({ type: 'turn.completed', turnId: '', status: 'failed', error: err instanceof Error ? err.message : String(err) });
              return false;
            })} />
        </>
      )}
    </div>
  );
}
