import { useEffect, useState } from 'react';
import type { DeepPartial, PostingMode, Settings, StylesMode } from '../../shared/settings';
import { confirmPostingMode, confirmStylesMode } from '../posting-mode';
import type { HistoryStats, ModelList, PageConfigKind, PageConfigStatus } from '../../shared/sidebar-api';
import { LIBRARY_FOLDER_NAME } from '../../shared/constants';
import { PROVIDER_KINDS, PROVIDER_LABELS, type ProviderKind } from '../../shared/agent';
import { modelLabel, providerState } from '../provider-ui';
import { providerFixHint } from '../setup';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

const set = (patch: DeepPartial<Settings>) => void window.xpilot.setSettings(patch);

/**
 * Which backend answers, and the settings of the one that does. Both are offered whatever is in
 * use: Connect proves the other one works before it is switched to, on its own throwaway process.
 */
function ModelsSection(props: { settings: Settings; connected: ProviderKind[]; onConnected: (kind: ProviderKind) => void }) {
  const active = props.settings.agent.provider;
  const [list, setList] = useState<ModelList | null>(null);
  const [checking, setChecking] = useState<ProviderKind | null>(null);
  const [results, setResults] = useState<Partial<Record<ProviderKind, string>>>({});
  const [binError, setBinError] = useState<string | null>(null);
  useEffect(() => {
    if (!active) return;
    let live = true;
    void window.xpilot.listModels(active).then(
      (r) => {
        if (live) setList(r);
      },
      () => {
        if (live) setList({ provider: active, models: [], unavailable: true });
      },
    );
    return () => {
      live = false;
    };
  }, [active]);
  const { onConnected } = props;
  const check = (kind: ProviderKind) => {
    setChecking(kind);
    setResults((r) => ({ ...r, [kind]: undefined }));
    void window.xpilot
      .probeProvider(kind)
      .then(
        (r) => {
          if (!r.ok) return { [kind]: `${r.error} — ${providerFixHint(kind, r.error)}` };
          onConnected(kind);
          return { [kind]: `Answered${r.model ? ` on ${r.model}` : ''}.` };
        },
        (err: unknown) => ({ [kind]: err instanceof Error ? err.message : String(err) }),
      )
      .then((r) => setResults((prev) => ({ ...prev, ...r })))
      .finally(() => setChecking(null));
  };
  const chooseBinary = (kind: ProviderKind, action: 'choose' | 'clear') => {
    setBinError(null);
    void window.xpilot
      .setProviderBinary(kind, action)
      .catch((err: unknown) => setBinError(err instanceof Error ? err.message : String(err)));
  };

  const models = list?.provider === active ? list.models : [];
  const claude = props.settings.agent.claude;
  const codex = props.settings.agent.codex;
  const modelId = active === 'claude' ? claude.model : active === 'codex' ? codex.model : null;
  const current = models.find((m) => m.id === (modelId ?? models.find((x) => x.isDefault)?.id));
  const effort = active === 'claude' ? claude.effort : codex.reasoningEffort;
  const binPath = active === 'claude' ? claude.binPath : active === 'codex' ? codex.binPath : null;
  const setModel = (id: string | null) =>
    set(
      active === 'claude' ? { agent: { claude: { model: id, effort: null } } } : { agent: { codex: { model: id, reasoningEffort: null } } },
    );
  const setEffort = (value: string) =>
    set(
      active === 'claude'
        ? { agent: { claude: { effort: (value || null) as Settings['agent']['claude']['effort'] } } }
        : { agent: { codex: { reasoningEffort: value || null } } },
    );

  return (
    <fieldset className="settings-group">
      <legend>Models</legend>
      {PROVIDER_KINDS.map((kind) => (
        <div className="provider" key={kind}>
          <div className="row">
            <span className="provider-name">{PROVIDER_LABELS[kind]}</span>
            <span className="badge">
              {providerState({ active: kind === active, checking: checking === kind, connected: props.connected.includes(kind) })}
            </span>
            <div className="spacer" />
            <button disabled={kind === active} onClick={() => void window.xpilot.setProvider(kind)}>
              Use
            </button>
            <button disabled={checking !== null} onClick={() => check(kind)}>
              {kind === active || props.connected.includes(kind) ? 'Check' : 'Connect'}
            </button>
          </div>
          {results[kind] && <p className="hint">{results[kind]}</p>}
        </div>
      ))}
      {!active && <p className="hint">No model is connected yet. Connect one and it becomes the agent XPilot drives.</p>}
      {active && (
        <>
          <label>
            {PROVIDER_LABELS[active]} model
            <select value={modelId ?? ''} onChange={(e) => setModel(e.target.value || null)}>
              <option value="">{PROVIDER_LABELS[active]} default</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName}
                </option>
              ))}
              {modelId && !models.some((m) => m.id === modelId) && <option value={modelId}>{modelId}</option>}
            </select>
          </label>
          {list?.provider === active && list.unavailable && (
            <p className="hint">
              Could not read {PROVIDER_LABELS[active]}&rsquo;s model list; {modelLabel(active, modelId, models)} stays in use.
            </p>
          )}
          {current && current.reasoningEfforts.length > 0 && (
            <label>
              Reasoning effort
              <select value={effort ?? ''} onChange={(e) => setEffort(e.target.value)}>
                <option value="">Model default</option>
                {current.reasoningEfforts.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Web search
            {active === 'claude' ? (
              <select
                value={claude.webSearch}
                onChange={(e) => set({ agent: { claude: { webSearch: e.target.value as Settings['agent']['claude']['webSearch'] } } })}
              >
                <option value="on">On (the agent may search the web)</option>
                <option value="off">Off</option>
              </select>
            ) : (
              <select
                value={codex.webSearch}
                onChange={(e) => set({ agent: { codex: { webSearch: e.target.value as Settings['agent']['codex']['webSearch'] } } })}
              >
                <option value="live">Live (fact-check against the web)</option>
                <option value="cached">Cached index only</option>
                <option value="disabled">Off</option>
              </select>
            )}
          </label>
          {active === 'codex' && (
            <label>
              Codex command approvals
              <select
                value={codex.approvalPolicy}
                onChange={(e) =>
                  set({ agent: { codex: { approvalPolicy: e.target.value as Settings['agent']['codex']['approvalPolicy'] } } })
                }
              >
                <option value="on-request">Ask when Codex requests</option>
                <option value="untrusted">Ask for anything untrusted</option>
              </select>
            </label>
          )}
          <label>
            {PROVIDER_LABELS[active]} binary
            <div className="row">
              <code>{binPath ?? 'auto-detect'}</code>
              <button onClick={() => chooseBinary(active, 'choose')}>Choose…</button>
              {binPath && <button onClick={() => chooseBinary(active, 'clear')}>Clear</button>}
            </div>
          </label>
          {binError && <p className="hint">{binError}</p>}
        </>
      )}
    </fieldset>
  );
}

export function SettingsPanel({
  settings,
  connected,
  onConnected,
}: {
  settings: Settings;
  /** Providers that answered a Connect in this session; the rows say so until the app restarts. */
  connected: ProviderKind[];
  onConnected: (kind: ProviderKind) => void;
}) {
  const [stats, setStats] = useState<HistoryStats | null>(null);
  const [pageConfig, setPageConfig] = useState<PageConfigStatus | null>(null);
  useEffect(() => {
    void window.xpilot
      .historyStats()
      .then(setStats)
      .catch(() => setStats(null));
  }, []);
  // Refetched whenever settings change too, so a count the agent moved is not left stale on screen.
  useEffect(() => {
    void window.xpilot
      .pageConfigStatus()
      .then(setPageConfig)
      .catch(() => setPageConfig(null));
  }, [settings]);
  const reset = (kind: PageConfigKind, question: string) => {
    if (confirm(question)) void window.xpilot.resetPageConfig(kind).then(setPageConfig);
  };

  return (
    <div className="panel settings">
      <ModelsSection settings={settings} connected={connected} onConnected={onConnected} />
      <label>
        Posting mode
        <select
          value={settings.posting.mode}
          onChange={(e) => {
            const mode = confirmPostingMode(e.target.value as PostingMode, confirm);
            if (mode) set({ posting: { mode } });
          }}
        >
          <option value="confirm">Confirm each post in the sidebar</option>
          <option value="autonomous">Autonomous (agent clicks Post)</option>
        </select>
      </label>
      <label>
        Agent likes
        <select value={settings.likes.mode} onChange={(e) => set({ likes: { mode: e.target.value as 'auto' | 'confirm' } })}>
          <option value="confirm">Confirm each like in the sidebar</option>
          <option value="auto">Autonomous (needed for scheduled liking)</option>
        </select>
      </label>
      <label>
        Page styles
        <select
          value={settings.styles.mode}
          onChange={(e) => {
            const mode = confirmStylesMode(e.target.value as StylesMode, confirm);
            if (mode) set({ styles: { mode } });
          }}
        >
          <option value="confirm">Confirm each stylesheet in the sidebar</option>
          <option value="autonomous">Autonomous (agent restyles the page)</option>
        </select>
      </label>
      <label>
        Library folder
        <div className="row">
          <code>{settings.library.dir ?? `~/Documents/${LIBRARY_FOLDER_NAME}`}</code>
          <button onClick={() => void window.xpilot.chooseLibraryDir()}>Change…</button>
        </div>
      </label>
      <fieldset className="settings-group">
        <legend>Page config</legend>
        <label>
          Page styles
          <div className="row">
            <code>{pageConfig?.styles.path ?? 'page-styles.css'}</code>
            <button onClick={() => void window.xpilot.openPageConfig('styles')}>Open file</button>
            <button onClick={() => reset('styles', 'Remove every rule from the page stylesheet?')}>Reset</button>
          </div>
        </label>
        <p className="hint">
          {pageConfig?.styles.lastError ? `Not applied: ${pageConfig.styles.lastError} · ` : ''}
          Plain CSS applied to the X page in this window, and to nothing else. Edit the file or ask the agent to restyle the page; it is
          re-applied as soon as it is saved.
        </p>
        <label>
          Selectors
          <div className="row">
            <code>{pageConfig?.selectors.path ?? 'selectors.json'}</code>
            <button onClick={() => void window.xpilot.openPageConfig('selectors')}>Open file</button>
            <button onClick={() => reset('selectors', 'Remove every selector override and go back to the ones XPilot ships?')}>
              Reset all
            </button>
          </div>
        </label>
        <p className="hint">
          {pageConfig ? `${pageConfig.selectors.overridden} overridden, ${pageConfig.selectors.stale} stale · ` : ''}
          {pageConfig?.selectors.lastError ? `Not in effect: ${pageConfig.selectors.lastError} · ` : ''}
          The CSS selectors XPilot uses to read x.com. Overrides survive app updates and are flagged stale when the selector XPilot ships
          changes; ask the agent to repair one if a page read stops working. The keys that decide what XPilot clicks can only be changed
          here, in the file.
        </p>
      </fieldset>
      <fieldset className="settings-group">
        <legend>History</legend>
        <p className="hint">
          {stats
            ? `${formatBytes(stats.dbBytes)} · ${stats.conversations} conversations, ${stats.posts} liked posts, ${stats.library} PDFs`
            : 'Reading the database size…'}
        </p>
        <label>
          Conversations to keep
          <input
            type="number"
            min={10}
            max={5000}
            step={10}
            value={settings.history.keepConversations}
            onChange={(e) => {
              const keepConversations = Number(e.target.value);
              if (keepConversations >= 10 && keepConversations <= 5000) set({ history: { keepConversations } });
            }}
          />
        </label>
        <label>
          Days to keep them
          <input
            type="number"
            min={7}
            max={3650}
            value={settings.history.keepDays}
            onChange={(e) => {
              const keepDays = Number(e.target.value);
              if (keepDays >= 7 && keepDays <= 3650) set({ history: { keepDays } });
            }}
          />
        </label>
        <p className="hint">
          Older transcripts are deleted a few times a day. The open conversation and any thread a scheduled task resumes are always kept.
        </p>
      </fieldset>
      <label>
        Liked-post index
        <div className="row">
          <button
            className="danger"
            onClick={() => {
              if (confirm('Delete the local index of liked posts? PDFs are kept.')) void window.xpilot.clearHistory();
            }}
          >
            Clear history
          </button>
        </div>
      </label>
      <p className="hint">
        Changing the model, effort, or approval policy restarts the agent and resumes the current thread; switching providers starts a new
        one.
      </p>
    </div>
  );
}
