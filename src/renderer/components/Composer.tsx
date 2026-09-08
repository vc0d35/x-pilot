import { useEffect, useRef, useState } from 'react';
import type { PageContext } from '../../shared/page';

export function Composer(props: { disabled: boolean; running: boolean; focus: PageContext | null; onSend: (text: string, ctx: PageContext | null) => Promise<boolean>; onStop: () => void }) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => window.xpilot.onFocusInput(() => inputRef.current?.focus()), []);
  const [sending, setSending] = useState(false);
  const active = props.focus;
  const submit = async () => {
    const t = text.trim();
    if (!t || props.disabled || props.running || sending) return;
    setSending(true);
    const ok = await props.onSend(t, active);
    setSending(false);
    if (ok) setText('');
  };
  return (
    <footer className="composer">
      <div className="composer-row">
        <textarea ref={inputRef} value={text} placeholder={props.disabled ? 'Agent not ready' : 'Ask about this page, or tell me what to do… (⌘↩ to send)'}
          disabled={props.disabled || sending} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submit(); } }} />
        {props.running
        ? <button onClick={props.onStop}>Stop</button>
        : <button onClick={submit} disabled={props.disabled || sending || !text.trim()}>Send</button>}
      </div>
    </footer>
  );
}
