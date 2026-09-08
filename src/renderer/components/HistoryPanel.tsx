import { useEffect, useState } from 'react';
import type { Conversation } from '../../shared/sidebar-api';

export function HistoryPanel(props: { currentThreadId: string | null; onOpen: (threadId: string) => void }) {
  const [items, setItems] = useState<Conversation[]>([]);
  useEffect(() => { void window.xpilot.listConversations().then(setItems); }, []);
  if (items.length === 0) return <div className="panel"><p className="hint">No conversations yet.</p></div>;
  return (
    <div className="panel">
      {items.map((c) => (
        <button key={c.threadId} className={`conv${c.threadId === props.currentThreadId ? ' conv-current' : ''}`} onClick={() => props.onOpen(c.threadId)}>
          <span className="conv-title">{c.title || (c.kind === 'task' ? 'Task run' : 'Untitled')}</span>
          <span className="conv-meta">{c.kind === 'task' && <span className="badge">task</span>}{new Date(c.updatedAt).toLocaleString()}</span>
        </button>
      ))}
    </div>
  );
}
