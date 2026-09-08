import { useEffect, useRef, useState } from 'react';
import type { Entry, ToolCall } from '../state';
import { groupEntries } from '../grouping';

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

export function EntryList({ entries, onResolve }: { entries: Entry[]; onResolve: (id: string, d: string) => void }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [entries]);
  return (
    <main className="entries">
      {groupEntries(entries).map((en, i) => {
        if (en.kind === 'message') return <div key={en.message.id + i} className={`msg msg-${en.message.role}`}>{en.message.text}{en.message.streaming ? '▍' : ''}</div>;
        if (en.kind === 'tools') return <ToolGroup key={en.key} calls={en.calls} />;
        return <ApprovalCard key={en.request.id} entry={en} onResolve={onResolve} />;
      })}
      <div ref={endRef} />
    </main>
  );
}
