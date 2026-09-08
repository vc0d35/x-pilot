import { useEffect, useRef, useState } from 'react';
import type { Entry, State, ToolCall } from '../state';
import { groupEntries } from '../grouping';
import { Markdown } from './Markdown';

function ToolRow({ call }: { call: ToolCall }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`tool tool-${call.status}`}>
      <button className="tool-head" onClick={() => setOpen(!open)}>
        <span className="tool-name">{call.name}</span>
        <span className="tool-status">{call.status}</span>
      </button>
      {open && (
        <pre className="tool-body">
          {JSON.stringify(call.args ?? {}, null, 2)}
          {call.output ? `\n\n→ ${call.output.slice(0, 4000)}` : ''}
        </pre>
      )}
    </div>
  );
}

function ApprovalCard({ entry, onResolve }: { entry: Extract<Entry, { kind: 'approval' }>; onResolve: (id: string, d: string) => void }) {
  const { request, decision } = entry;
  return (
    <div className={`approval approval-${request.kind}`}>
      <div className="approval-title">{request.title}</div>
      <pre className="approval-detail">{request.detail}</pre>
      {decision
        ? <div className="approval-decision">Decision: {decision}</div>
        : <div className="approval-actions">{request.options.map((o) => <button key={o.id} onClick={() => onResolve(request.id, o.id)}>{o.label}</button>)}</div>}
    </div>
  );
}

function ToolGroup({ calls }: { calls: ToolCall[] }) {
  const [open, setOpen] = useState(false);
  const running = calls.some((c) => c.status === 'running');
  const failed = calls.filter((c) => c.status === 'failed').length;
  const names = [...new Set(calls.map((c) => c.name))].join(', ');
  return (
    <div className={`tool-group${running ? ' tool-group-running' : ''}`}>
      <button className="tool-group-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>{open ? '▾' : '▸'} {calls.length} tool call{calls.length === 1 ? '' : 's'}</span>
        <span className="tool-group-names">{names}</span>
        {running && <span className="tool-status">running…</span>}
        {!running && failed > 0 && <span className="tool-status tool-status-failed">{failed} failed</span>}
      </button>
      {open && <div className="tool-group-body">{calls.map((c) => <ToolRow key={c.id} call={c} />)}</div>}
    </div>
  );
}

function ThinkingRow({ steps }: { steps: { id: string; text: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="thinking">
      <button className="tool-group-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>{open ? '▾' : '▸'} thinking</span>
        <span className="tool-group-names">{steps.length} step{steps.length === 1 ? '' : 's'}</span>
      </button>
      {open && <div className="thinking-body">{steps.map((st) => <div key={st.id} className="thinking-step">{st.text}</div>)}</div>}
    </div>
  );
}

export function EntryList({ entries, activity, onResolve }: { entries: Entry[]; activity: State['activity']; onResolve: (id: string, d: string) => void }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [entries, activity]);
  return (
    <main className="entries">
      {groupEntries(entries).map((en, i) => {
        if (en.kind === 'message') {
          const body = en.message.role === 'agent' ? <Markdown text={en.message.text} /> : en.message.text;
          return <div key={en.message.id + i} className={`msg msg-${en.message.role}`}>{body}{en.message.streaming ? '▍' : ''}</div>;
        }
        if (en.kind === 'tools') return <ToolGroup key={en.key} calls={en.calls} />;
        if (en.kind === 'thinking') return <ThinkingRow key={'th-' + en.id} steps={en.steps} />;
        return <ApprovalCard key={en.request.id} entry={en} onResolve={onResolve} />;
      })}
      <ActivityLine activity={activity} />
      <div ref={endRef} />
    </main>
  );
}

const TOOL_VERBS: Record<string, string> = {
  web_search: 'searching the web', x_search: 'searching X', x_read_post: 'reading a post', x_read_visible_posts: 'reading the timeline',
  x_scroll: 'scrolling', x_navigate: 'opening a page', x_get_page_state: 'checking the page', xpilot_search_history: 'searching your likes',
  xpilot_save_article_pdf: 'saving a PDF', xpilot_list_library: 'listing PDFs', x_compose_post: 'drafting a post', x_submit_post: 'posting', shell: 'running a command',
};

export function activityLabel(a: NonNullable<State['activity']>): string {
  if (a.activity === 'thinking') return 'thinking';
  if (a.activity === 'writing') return 'writing';
  return TOOL_VERBS[a.detail ?? ''] ?? `running ${a.detail ?? 'a tool'}`;
}

export function ActivityLine({ activity }: { activity: State['activity'] }) {
  if (!activity) return null;
  return <div className="activity" aria-live="polite"><span className="status-dot" />{activityLabel(activity)}…</div>;
}
