import { useEffect, useState } from 'react';
import type { PostingMode, Settings } from '../../shared/settings';
import { confirmPostingMode } from '../posting-mode';
import type { HistoryStats, ModelInfo, SelectorsInfo } from '../../shared/sidebar-api';
import { LIBRARY_FOLDER_NAME } from '../../shared/constants';

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

export function SettingsPanel({ settings }: { settings: Settings }) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [stats, setStats] = useState<HistoryStats | null>(null);
  const [stylesPath, setStylesPath] = useState<string | null>(null);
  const [selectors, setSelectors] = useState<SelectorsInfo | null>(null);
  useEffect(() => {
    void window.xpilot
      .listModels()
      .then(setModels)
      .catch(() => setModels([]));
  }, []);
  useEffect(() => {
    void window.xpilot
      .historyStats()
      .then(setStats)
      .catch(() => setStats(null));
  }, []);
  useEffect(() => {
    void window.xpilot
      .pageStylesPath()
      .then(setStylesPath)
      .catch(() => setStylesPath(null));
  }, []);
  useEffect(() => {
    void window.xpilot
      .selectorsInfo()
      .then(setSelectors)
      .catch(() => setSelectors(null));
  }, []);
  const codex = settings.agent.codex;
  const current = models.find((m) => m.id === (codex.model ?? models.find((x) => x.isDefault)?.id));
  const set = (patch: Parameters<typeof window.xpilot.setSettings>[0]) => void window.xpilot.setSettings(patch);

  return (
    <div className="panel settings">
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
        Model
        <select
          value={codex.model ?? ''}
          onChange={(e) => set({ agent: { codex: { model: e.target.value || null, reasoningEffort: null } } })}
        >
          <option value="">Codex default</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName}
            </option>
          ))}
        </select>
      </label>
      {current && current.reasoningEfforts.length > 0 && (
        <label>
          Reasoning effort
          <select
            value={codex.reasoningEffort ?? ''}
            onChange={(e) => set({ agent: { codex: { reasoningEffort: e.target.value || null } } })}
          >
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
        Agent likes
        <select value={settings.likes.mode} onChange={(e) => set({ likes: { mode: e.target.value as 'auto' | 'confirm' } })}>
          <option value="confirm">Confirm each like in the sidebar</option>
          <option value="auto">Autonomous (needed for scheduled liking)</option>
        </select>
      </label>
      <label>
        Web search
        <select
          value={codex.webSearch}
          onChange={(e) => set({ agent: { codex: { webSearch: e.target.value as Settings['agent']['codex']['webSearch'] } } })}
        >
          <option value="live">Live (fact-check against the web)</option>
          <option value="cached">Cached index only</option>
          <option value="disabled">Off</option>
        </select>
      </label>
      <label>
        Codex command approvals
        <select
          value={codex.approvalPolicy}
          onChange={(e) => set({ agent: { codex: { approvalPolicy: e.target.value as Settings['agent']['codex']['approvalPolicy'] } } })}
        >
          <option value="on-request">Ask when Codex requests</option>
          <option value="untrusted">Ask for anything untrusted</option>
        </select>
      </label>
      <label>
        Codex binary
        <div className="row">
          <code>{codex.binPath ?? 'auto-detect'}</code>
          <button onClick={() => void window.xpilot.setCodexBinary('choose')}>Choose…</button>
          {codex.binPath && <button onClick={() => void window.xpilot.setCodexBinary('clear')}>Clear</button>}
        </div>
      </label>
      <label>
        Library folder
        <div className="row">
          <code>{settings.library.dir ?? `~/Documents/${LIBRARY_FOLDER_NAME}`}</code>
          <button onClick={() => void window.xpilot.chooseLibraryDir()}>Change…</button>
        </div>
      </label>
      <label>
        Page styles
        <div className="row">
          <code>{stylesPath ?? 'page-styles.css'}</code>
          <button onClick={() => void window.xpilot.openPageStyles()}>Open file</button>
          <button
            onClick={() => {
              if (confirm('Remove every rule from the page stylesheet?')) void window.xpilot.resetPageStyles();
            }}
          >
            Reset
          </button>
        </div>
      </label>
      <p className="hint">
        Plain CSS applied to the X page in this window, and to nothing else. Edit the file or ask the agent to restyle the page; it is
        re-applied as soon as it is saved.
      </p>
      <label>
        Selectors
        <div className="row">
          <code>{selectors?.path ?? 'selectors.json'}</code>
          <button onClick={() => void window.xpilot.openSelectors()}>Open file</button>
          <button
            onClick={() => {
              if (confirm('Remove every selector override and go back to the ones XPilot ships?'))
                void window.xpilot.resetSelectors().then(setSelectors);
            }}
          >
            Reset all
          </button>
        </div>
      </label>
      <p className="hint">
        {selectors ? `${selectors.overridden} overridden, ${selectors.stale} stale · ` : ''}
        The CSS selectors XPilot uses to read x.com. Overrides survive app updates and are flagged stale when the selector XPilot ships
        changes; ask the agent to repair one if a page read stops working.
      </p>
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
      <p className="hint">Changing the model, effort, or approval policy restarts the agent and resumes the current thread.</p>
    </div>
  );
}
