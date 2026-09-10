import { useEffect, useReducer, useState } from 'react';
import { reduce, initialState, reportsBrokenAdapter, fixItPrompt } from './state';
import { setupIssue } from './setup';
import { Header, ExpandHandle, type Panel, ModelPill } from './components/Header';
import { EntryList } from './components/EntryList';
import { Composer } from './components/Composer';
import { LibraryPanel } from './components/LibraryPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { HistoryPanel } from './components/HistoryPanel';
import { SetupCard } from './components/SetupCard';
import { ViewErrorBanner } from './components/ViewErrorBanner';
import { OnboardingCard } from './components/OnboardingCard';
import { ModelPicker } from './components/ModelPicker';
import { needsProviderChoice, pillText, showReconnect } from './provider-ui';
import { PROVIDER_LABELS, type ProviderKind } from '../shared/agent';
import type { PageContext } from '../shared/page';
import type { Settings } from '../shared/settings';
import type { ModelList } from '../shared/sidebar-api';

export function App() {
  const [state, dispatch] = useReducer(reduce, initialState);
  const [focus, setFocus] = useState<PageContext | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [panel, setPanel] = useState<Panel>('chat');
  const [modelList, setModelList] = useState<ModelList | null>(null);
  // Which backends answered a Connect: a session-long note, so a Settings row reopened still says so.
  const [connected, setConnected] = useState<ProviderKind[]>([]);
  const rememberConnected = (kind: ProviderKind) => setConnected((c) => (c.includes(kind) ? c : [...c, kind]));
  // Bumped whenever the conversation list behind the History panel changes underneath it.
  const [historyKey, setHistoryKey] = useState(0);
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

  const provider = settings?.agent.provider ?? null;
  const modelId = !settings || !provider ? null : provider === 'claude' ? settings.agent.claude.model : settings.agent.codex.model;
  // Refetched once the agent is up: Codex only has a list to give while its process is running.
  const running = state.status === 'ready' || state.status === 'running';
  useEffect(() => {
    if (!provider) return;
    let live = true;
    void window.xpilot.listModels(provider).then(
      (r) => {
        if (live) setModelList(r);
      },
      () => {
        if (live) setModelList({ provider, models: [], unavailable: true });
      },
    );
    return () => {
      live = false;
    };
  }, [provider, running]);
  // A list belongs to the provider that answered it; after a switch the new one's has not arrived.
  const models = modelList?.provider === provider ? modelList.models : [];

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
          : view.kind === 'foreign'
            ? { type: 'view.foreign', threadId: view.threadId, provider: view.provider }
            : { type: 'view.live' },
      );
    });
  };
  /**
   * Back to an empty live conversation. New thread asks main for one; switching backends has already
   * started one, and without this the previous backend's transcript stays on screen above it.
   */
  const showFreshThread = () => {
    dispatch({ type: 'reset' });
    setHistoryKey((k) => k + 1);
  };
  const backToChat = () => {
    if (state.threadId) openConversation(state.threadId);
    else dispatch({ type: 'reset' });
  };
  const showPanel = (p: Panel) => {
    if (p === 'chat' && (state.viewing || state.foreign)) backToChat();
    else setPanel(p);
  };
  const issue = setupIssue(state);
  const choosing = settings !== null && needsProviderChoice(provider, state.status, state.statusMessage);
  const readOnly = !!state.viewing || !!state.foreign;
  const adapterBroken = state.entries.some((en) => en.kind === 'tool' && en.call.status === 'done' && reportsBrokenAdapter(en.call.output));

  if (collapsed) return <ExpandHandle status={state.status} onExpand={() => void window.xpilot.setSidebarCollapsed(false)} />;

  return (
    <div className="app">
      <Header
        onNewThread={() => {
          showFreshThread();
          void window.xpilot.newThread();
        }}
        panel={panel}
        onPanel={showPanel}
        onCollapse={() => void window.xpilot.setSidebarCollapsed(true)}
      />
      <div className="pill-row">
        <ModelPill
          status={state.status}
          message={state.statusMessage}
          label={pillText({ status: state.status, statusMessage: state.statusMessage, provider, modelId, models })}
          canReconnect={showReconnect(state.status, provider)}
          onOpenSettings={() => showPanel('settings')}
          onReconnect={reconnect}
        />
      </div>
      {adapterBroken && <div className="banner">X changed its layout; some tools may fail until the adapter is updated.</div>}
      {state.taskRun?.visibleWindow && (
        <div className="banner run-banner">
          <span className="run-banner-text">A scheduled task is using your window: {state.taskRun.title}</span>
          <button className="link" onClick={() => void window.xpilot.stopTaskRun()}>
            Stop
          </button>
        </div>
      )}
      {state.view && (
        <div className="banner run-banner">
          <span className="run-banner-text">Custom view: {state.view}</span>
          <button className="link" onClick={() => void window.xpilot.deactivateView()}>
            Back to X
          </button>
        </div>
      )}
      {state.viewError && (
        <ViewErrorBanner
          failure={state.viewError}
          stillShowing={state.view !== null}
          onDismiss={() => dispatch({ type: 'view.error.dismiss' })}
          onFix={() => {
            // Sent as the user, through the same path the composer uses, so it is a message in the
            // transcript rather than something the app did to the conversation behind their back.
            void window.xpilot.send(fixItPrompt(state.viewError!), null);
            dispatch({ type: 'view.error.dismiss' });
          }}
        />
      )}
      {settings?.posting.mode === 'autonomous' && (
        <div className="banner">Autonomous posting is on: the agent can post without confirmation.</div>
      )}
      {panel === 'history' ? (
        <HistoryPanel key={historyKey} currentThreadId={state.threadId} activeProvider={provider} onOpen={openConversation} />
      ) : panel === 'library' ? (
        <LibraryPanel />
      ) : panel === 'settings' ? (
        settings && (
          <SettingsPanel settings={settings} connected={connected} onConnected={rememberConnected} onProviderSwitched={showFreshThread} />
        )
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
          {state.foreign && (
            <div className="banner run-banner">
              <span className="run-banner-text">
                This conversation was with {PROVIDER_LABELS[state.foreign.provider]}. Switch to {PROVIDER_LABELS[state.foreign.provider]} in
                Settings to continue.
              </span>
              <button className="link" onClick={() => setPanel('settings')}>
                Settings
              </button>
            </div>
          )}
          {choosing && <ModelPicker onConnected={rememberConnected} />}
          {issue && (
            <SetupCard issue={issue} provider={provider ?? 'codex'} onRetry={reconnect} onOpenSettings={() => setPanel('settings')} />
          )}
          {settings && !choosing && !settings.ui.onboarded && (
            <OnboardingCard
              libraryDir={settings.library.dir ?? '~/Documents/X Pilot'}
              onOpenSettings={() => setPanel('settings')}
              onDismiss={() => void window.xpilot.setSettings({ ui: { onboarded: true } })}
            />
          )}
          <EntryList
            entries={state.entries}
            activity={readOnly ? null : state.activity}
            onResolve={(id, d, note) => void window.xpilot.resolveApproval(id, d, note)}
            onResolveInput={(id, answers) => void window.xpilot.resolveInput(id, answers)}
          />
          <Composer
            disabled={readOnly || choosing || !running}
            placeholder={
              state.viewing
                ? 'Scheduled runs are read-only. Ask in your own conversation.'
                : state.foreign
                  ? `Read-only: ${PROVIDER_LABELS[state.foreign.provider]} wrote this conversation.`
                  : choosing
                    ? 'Choose a model to start'
                    : undefined
            }
            running={!readOnly && state.running}
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
