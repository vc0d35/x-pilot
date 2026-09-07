import { useEffect, useReducer, useState } from 'react';
import { reduce, initialState } from './state';
import { Header } from './components/Header';
import { EntryList } from './components/EntryList';
import { Composer } from './components/Composer';
import type { PageContext } from '../shared/page';

export function App() {
  const [state, dispatch] = useReducer(reduce, initialState);
  const [focus, setFocus] = useState<PageContext | null>(null);

  useEffect(() => window.xpilot.onEvent(dispatch), []);
  useEffect(() => window.xpilot.onFocus(setFocus), []);

  return (
    <div className="app">
      <Header status={state.status} statusMessage={state.statusMessage} running={state.running}
        onStop={() => void window.xpilot.interrupt()} onNewThread={() => void window.xpilot.newThread()} />
      <EntryList entries={state.entries} onResolve={(id, d) => void window.xpilot.resolveApproval(id, d)} />
      <Composer disabled={state.status !== 'ready' && state.status !== 'running'} running={state.running} focus={focus}
        onSend={(text, ctx) => window.xpilot.send(text, ctx).catch((err) =>
          dispatch({ type: 'turn.completed', turnId: '', status: 'failed', error: err instanceof Error ? err.message : String(err) }))} />
    </div>
  );
}
