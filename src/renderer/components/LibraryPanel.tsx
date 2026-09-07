import { useEffect, useState } from 'react';
import type { LibraryItem } from '../../shared/sidebar-api';

export function LibraryPanel() {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [error, setError] = useState<{ id: number; message: string } | null>(null);
  useEffect(() => { void window.xpilot.listLibrary().then(setItems); }, []);
  const open = (it: LibraryItem) => {
    setError(null);
    window.xpilot.openPdf(it.path).catch((err: unknown) => setError({ id: it.id, message: err instanceof Error ? err.message : String(err) }));
  };
  if (items.length === 0) return <div className="panel"><p>No PDFs yet. Ask the agent to "save this as a PDF".</p></div>;
  return (
    <div className="panel">
      {items.map((it) => (
        <div key={it.id} className="lib-item">
          <div className="lib-title">{it.title || it.url}</div>
          <div className="lib-meta">{new Date(it.savedAt).toLocaleString()} · <a href={it.url} onClick={(e) => e.preventDefault()}>{it.url}</a></div>
          <button onClick={() => open(it)}>Open PDF</button>
          {error?.id === it.id && <div className="banner">Could not open this PDF: {error.message}</div>}
        </div>
      ))}
    </div>
  );
}
