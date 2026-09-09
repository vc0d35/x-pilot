import { useEffect, useReducer, useState } from 'react';
import { reduce, initialState, reportsBrokenAdapter } from './state';
import { setupIssue } from './setup';
import { Header, ExpandHandle, type Panel } from './components/Header';
import { EntryList } from './components/EntryList';
import { Composer } from './components/Composer';
import { LibraryPanel } from './components/LibraryPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { HistoryPanel } from './components/HistoryPanel';
import { SetupCard } from './components/SetupCard';
import { OnboardingCard } from './components/OnboardingCard';
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
  useEffect(() => {
    void window.xpilot.getSettings().then(setSettings);
    return window.xpilot.onSettings(setSettings);
  }, []);

  const reconnect = () => void window.xpilot.reconnect();
  const issue = setupIssue(state);
  const adapterBroken = state.entries.some((en) => en.kind === 'tool' && en.call.status === 'done' && reportsBrokenAdapter(en.call.output));

  if (collapsed) return <ExpandHandle status={state.status} onExpand={() => void window.xpilot.setSidebarCollapsed(false)} />;

  return (
    <div className="app">
      <Header
        status={state.status}
        statusMessage={state.statusMessage}
        onNewThread={() => {
          dispatch({ type: 'reset' });
          void window.xpilot.newThread();
        }}
        onReconnect={reconnect}
        panel={panel}
        onPanel={setPanel}
        onCollapse={() => void window.xpilot.setSidebarCollapsed(true)}
      />
      {adapterBroken && <div className="banner">X changed its layout; some tools may fail until the adapter is updated.</div>}
      {settings?.posting.mode === 'autonomous' && (
        <div className="banner">Autonomous posting is on: the agent can post without confirmation.</div>
      )}
      {panel === 'history' ? (
        <HistoryPanel
          currentThreadId={state.threadId}
          onOpen={(threadId) => {
            dispatch({ type: 'reset' });
            setPanel('chat');
            void window.xpilot.openConversation(threadId).then((events) => {
              for (const e of events) dispatch(e);
            });
          }}
        />
      ) : panel === 'library' ? (
        <LibraryPanel />
      ) : panel === 'settings' ? (
        settings && <SettingsPanel settings={settings} />
      ) : (
        <>
          {issue && <SetupCard issue={issue} onRetry={reconnect} onOpenSettings={() => setPanel('settings')} />}
          {settings && !settings.ui.onboarded && (
            <OnboardingCard
              libraryDir={settings.library.dir ?? '~/Documents/X Pilot'}
              onOpenSettings={() => setPanel('settings')}
              onDismiss={() => void window.xpilot.setSettings({ ui: { onboarded: true } })}
            />
          )}
          <EntryList
            entries={state.entries}
            activity={state.activity}
            onResolve={(id, d, note) => void window.xpilot.resolveApproval(id, d, note)}
            onResolveInput={(id, answers) => void window.xpilot.resolveInput(id, answers)}
          />
          <Composer
            disabled={state.status !== 'ready' && state.status !== 'running'}
            running={state.running}
            focus={focus}
            onStop={() => void window.xpilot.interrupt()}
            onSend={(text, ctx) =>
              window.xpilot.send(text, ctx).then(
                () => true,
                (err) => {
                  dispatch({
                    type: 'turn.completed',
                    turnId: '',
                    status: 'failed',
                    error: err instanceof Error ? err.message : String(err),
                  });
                  return false;
                },
              )
            }
          />
        </>
      )}
    </div>
  );
}
