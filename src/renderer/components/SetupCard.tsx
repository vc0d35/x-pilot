import { useState } from 'react';
import type { SetupIssue, SetupProblem } from '../setup';

const HEADLINE: Record<SetupProblem, string> = {
  missing: 'XPilot could not find the Codex CLI, so the agent cannot start.',
  'logged-out': 'Codex is installed but not logged in, so it cannot answer.',
  other: 'The agent stopped and could not be started again.',
};

const COMMANDS: Record<SetupProblem, string[]> = {
  missing: ['npm i -g @openai/codex', 'codex login'],
  'logged-out': ['codex login'],
  other: [],
};

const HINT: Record<SetupProblem, string> = {
  missing: 'Run these in Terminal, then Try again. Already installed? Codex may live outside the app’s PATH: set its full path in Settings.',
  'logged-out': 'Run this in Terminal, sign in, then Try again.',
  other: 'Try again restarts Codex and resumes this conversation.',
};

function Command({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    const done = navigator.clipboard?.writeText(text);
    if (!done) return;
    void done.then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => {});
  };
  return (
    <div className="setup-cmd">
      <code>{text}</code>
      <button className="link" onClick={copy}>{copied ? 'copied' : 'copy'}</button>
    </div>
  );
}

export function SetupCard({ issue, onRetry, onOpenSettings }: { issue: SetupIssue; onRetry: () => void; onOpenSettings: () => void }) {
  return (
    <div className="setup">
      <div className="setup-title">{HEADLINE[issue.problem]}</div>
      {COMMANDS[issue.problem].map((c) => <Command key={c} text={c} />)}
      {issue.problem === 'other' && <pre className="setup-detail">{issue.message}</pre>}
      <p className="hint">{HINT[issue.problem]}</p>
      <div className="row">
        <button onClick={onRetry}>Try again</button>
        <button className="link" onClick={onOpenSettings}>Codex binary path in Settings</button>
      </div>
    </div>
  );
}
