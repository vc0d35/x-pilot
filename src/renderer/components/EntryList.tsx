import { useEffect, useRef, useState } from 'react';
import type { Entry } from '../state';

function ToolRow({ call }: { call: Extract<Entry, { kind: 'tool' }>['call'] }) {
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

export function EntryList({ entries, onResolve }: { entries: Entry[]; onResolve: (id: string, d: string) => void }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [entries]);
  return (
    <main className="entries">
      {entries.map((en, i) => {
        if (en.kind === 'message') return <div key={en.message.id + i} className={`msg msg-${en.message.role}`}>{en.message.text}{en.message.streaming ? '▍' : ''}</div>;
        if (en.kind === 'tool') return <ToolRow key={en.call.id} call={en.call} />;
        return <ApprovalCard key={en.request.id} entry={en} onResolve={onResolve} />;
      })}
      <div ref={endRef} />
    </main>
  );
}
