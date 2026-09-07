import { useEffect, useState } from 'react';
import type { Settings } from '../../shared/settings';
import type { ModelInfo } from '../../shared/sidebar-api';

export function SettingsPanel({ settings }: { settings: Settings }) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  useEffect(() => { void window.xpilot.listModels().then(setModels).catch(() => setModels([])); }, []);
  const codex = settings.agent.codex;
  const current = models.find((m) => m.id === (codex.model ?? models.find((x) => x.isDefault)?.id));
  const set = (patch: Parameters<typeof window.xpilot.setSettings>[0]) => void window.xpilot.setSettings(patch);

  return (
    <div className="panel settings">
      <label>Posting mode
        <select value={settings.posting.mode} onChange={(e) => set({ posting: { mode: e.target.value as 'confirm' | 'autonomous' } })}>
          <option value="confirm">Confirm each post in the sidebar</option>
          <option value="autonomous">Autonomous (agent clicks Post)</option>
        </select>
      </label>
      <label>Model
        <select value={codex.model ?? ''} onChange={(e) => set({ agent: { codex: { model: e.target.value || null, reasoningEffort: null } } })}>
          <option value="">Codex default</option>
          {models.map((m) => <option key={m.id} value={m.id}>{m.displayName}</option>)}
        </select>
      </label>
      {current && current.reasoningEfforts.length > 0 && (
        <label>Reasoning effort
          <select value={codex.reasoningEffort ?? ''} onChange={(e) => set({ agent: { codex: { reasoningEffort: e.target.value || null } } })}>
            <option value="">Model default</option>
            {current.reasoningEfforts.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
      )}
      <label>Codex command approvals
        <select value={codex.approvalPolicy} onChange={(e) => set({ agent: { codex: { approvalPolicy: e.target.value as Settings['agent']['codex']['approvalPolicy'] } } })}>
          <option value="on-request">Ask when Codex requests</option>
          <option value="untrusted">Ask for anything untrusted</option>
          <option value="never">Never ask</option>
        </select>
      </label>
      <label>Library folder
        <div className="row"><code>{settings.library.dir ?? '~/Documents/X Pilot'}</code><button onClick={() => void window.xpilot.chooseLibraryDir()}>Change…</button></div>
      </label>
      <label>Liked-post index
        <div className="row"><button className="danger" onClick={() => { if (confirm('Delete the local index of liked posts? PDFs are kept.')) void window.xpilot.clearHistory(); }}>Clear history</button></div>
      </label>
      <p className="hint">Changing the model, effort, or approval policy restarts the agent and resumes the current thread.</p>
    </div>
  );
}
