import { useState } from 'react';
import { PROVIDER_KINDS, PROVIDER_LABELS, type ProviderKind } from '../../shared/agent';
import { PROVIDER_REQUIREMENT } from '../provider-ui';
import { providerFixHint } from '../setup';

/**
 * The first-run card: nothing can be asked until one backend is chosen, so Connect proves the CLI
 * answers (one throwaway turn) before the choice is written and the agent starts on it.
 */
export function ModelPicker({ onConnected }: { onConnected: (kind: ProviderKind) => void }) {
  const [probing, setProbing] = useState<ProviderKind | null>(null);
  const [errors, setErrors] = useState<Partial<Record<ProviderKind, string>>>({});
  const connect = (kind: ProviderKind) => {
    setProbing(kind);
    setErrors((e) => ({ ...e, [kind]: undefined }));
    void window.xpilot
      .probeProvider(kind)
      .then(
        (r) => {
          if (!r.ok) return Promise.reject(new Error(r.error));
          onConnected(kind);
          return window.xpilot.setProvider(kind);
        },
        (err: unknown) => Promise.reject(err instanceof Error ? err : new Error(String(err))),
      )
      .catch((err: Error) => setErrors((e) => ({ ...e, [kind]: err.message })))
      .finally(() => setProbing(null));
  };
  return (
    <div className="setup">
      <div className="setup-title">Choose a model to connect</div>
      <p className="hint">XPilot drives an agent you already have on this machine. Pick one; you can add the other in Settings later.</p>
      {PROVIDER_KINDS.map((kind) => {
        const error = errors[kind];
        return (
          <div className="picker-option" key={kind}>
            <div className="row">
              <span className="picker-name">{PROVIDER_LABELS[kind]}</span>
              <div className="spacer" />
              <button onClick={() => connect(kind)} disabled={probing !== null}>
                {probing === kind ? 'Connecting…' : 'Connect'}
              </button>
            </div>
            <p className="hint">
              {probing === kind ? `Asking ${PROVIDER_LABELS[kind]} to answer one question…` : PROVIDER_REQUIREMENT[kind]}
            </p>
            {error && (
              <p className="hint picker-error">
                {error}
                <br />
                {providerFixHint(kind, error)}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
