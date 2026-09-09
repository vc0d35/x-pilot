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

  useEffect(
    () => window.xpilot.onConversationEvent((m) => dispatch({ type: 'conversation.event', threadId: m.threadId, event: m.event })),
    [],
  );

  const reconnect = () => void window.xpilot.reconnect();
  /**
   * Opens a conversation in the chat pane. Main decides what that means: the user's own thread is
   * resumed, a scheduled run comes back as a read-only view. The view is dispatched after the
   * replay so the run's live state wins over the `turn.completed` of an earlier run in its log.
   */
  const openConversation = (threadId: string) => {
    dispatch({ type: 'reset' });
    setPanel('chat');
    void window.xpilot.openConversation(threadId).then(({ events, view }) => {
      for (const e of events) dispatch(e);
      dispatch(
        view.kind === 'task'
          ? { type: 'view.task', threadId: view.threadId, taskId: view.taskId, title: view.title, running: view.running }
          : { type: 'view.live' },
      );
    });
  };
  const backToChat = () => {
    if (state.threadId) openConversation(state.threadId);
    else dispatch({ type: 'reset' });
  };
  const showPanel = (p: Panel) => {
    if (p === 'chat' && state.viewing) backToChat();
    else setPanel(p);
  };
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
        onPanel={showPanel}
        onCollapse={() => void window.xpilot.setSidebarCollapsed(true)}
      />
      {adapterBroken && <div className="banner">X changed its layout; some tools may fail until the adapter is updated.</div>}
      {state.taskRun?.visibleWindow && (
        <div className="banner run-banner">
          <span className="run-banner-text">A scheduled task is using your window: {state.taskRun.title}</span>
          <button className="link" onClick={() => void window.xpilot.stopTaskRun()}>
            Stop
          </button>
        </div>
      )}
      {settings?.posting.mode === 'autonomous' && (
        <div className="banner">Autonomous posting is on: the agent can post without confirmation.</div>
      )}
      {panel === 'history' ? (
        <HistoryPanel currentThreadId={state.threadId} onOpen={openConversation} />
      ) : panel === 'library' ? (
        <LibraryPanel />
      ) : panel === 'settings' ? (
        settings && <SettingsPanel settings={settings} />
      ) : (
        <>
          {state.viewing && (
            <div className="banner run-banner">
              <span className="run-banner-text">
                Viewing a scheduled run: {state.viewing.title} &middot; {state.viewing.running ? 'running…' : 'finished'}
              </span>
              <button className="link" onClick={backToChat}>
                Back to chat
              </button>
            </div>
          )}
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
            activity={state.viewing ? null : state.activity}
            onResolve={(id, d, note) => void window.xpilot.resolveApproval(id, d, note)}
            onResolveInput={(id, answers) => void window.xpilot.resolveInput(id, answers)}
          />
          <Composer
            disabled={!!state.viewing || (state.status !== 'ready' && state.status !== 'running')}
            placeholder={state.viewing ? 'Scheduled runs are read-only. Ask in your own conversation.' : undefined}
            running={!state.viewing && state.running}
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
