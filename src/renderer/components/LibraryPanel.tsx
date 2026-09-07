import { useEffect, useState } from 'react';
import type { LibraryItem } from '../../shared/sidebar-api';

export function LibraryPanel() {
  const [items, setItems] = useState<LibraryItem[]>([]);
  useEffect(() => { void window.xpilot.listLibrary().then(setItems); }, []);
  if (items.length === 0) return <div className="panel"><p>No PDFs yet. Ask the agent to "save this as a PDF".</p></div>;
  return (
    <div className="panel">
      {items.map((it) => (
        <div key={it.id} className="lib-item">
          <div className="lib-title">{it.title || it.url}</div>
          <div className="lib-meta">{new Date(it.savedAt).toLocaleString()} · <a href={it.url} onClick={(e) => e.preventDefault()}>{it.url}</a></div>
          <button onClick={() => void window.xpilot.openPdf(it.path)}>Open PDF</button>
        </div>
      ))}
    </div>
  );
}
