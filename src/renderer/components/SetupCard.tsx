import { useState } from 'react';
import { providerFix, type SetupIssue } from '../setup';
import { PROVIDER_LABELS, type ProviderKind } from '../../shared/agent';

function Command({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    const clipboard = navigator.clipboard as Clipboard | undefined;
    if (!clipboard) return;
    void clipboard.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  };
  return (
    <div className="setup-cmd">
      <code>{text}</code>
      <button className="link" onClick={copy}>
        {copied ? 'copied' : 'copy'}
      </button>
    </div>
  );
}

export function SetupCard({
  issue,
  provider,
  onRetry,
  onOpenSettings,
}: {
  issue: SetupIssue;
  /** The backend in use: what to install, and what to log into, is its own. */
  provider: ProviderKind;
  onRetry: () => void;
  onOpenSettings: () => void;
}) {
  const fix = providerFix(provider, issue.problem);
  return (
    <div className="setup">
      <div className="setup-title">{fix.headline}</div>
      {fix.commands.map((c) => (
        <Command key={c} text={c} />
      ))}
      {(issue.problem === 'other' || issue.problem === 'missing') && <pre className="setup-detail">{issue.message}</pre>}
      <p className="hint">{fix.hint}</p>
      <div className="row">
        <button onClick={onRetry}>Try again</button>
        <button className="link" onClick={onOpenSettings}>
          {PROVIDER_LABELS[provider]} binary path in Settings
        </button>
      </div>
    </div>
  );
}
