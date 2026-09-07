import { useState } from 'react';
import type { PageContext } from '../../shared/page';

export function Composer(props: { disabled: boolean; running: boolean; focus: PageContext | null; onSend: (text: string, ctx: PageContext | null) => void }) {
  const [text, setText] = useState('');
  const submit = () => {
    const t = text.trim();
    if (!t || props.disabled || props.running) return;
    props.onSend(t, props.focus);
    setText('');
  };
  return (
    <footer className="composer">
      <textarea value={text} placeholder={props.disabled ? 'Agent not ready' : 'Ask about this page, or tell me what to do… (⌘↩ to send)'}
        disabled={props.disabled} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submit(); } }} />
      <button onClick={submit} disabled={props.disabled || props.running || !text.trim()}>Send</button>
    </footer>
  );
}
