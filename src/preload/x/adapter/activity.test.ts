// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { installUserActivityPing } from './activity';

/** jsdom forces `isTrusted` false on every dispatch; flip it on the internal event, as capture.test does. */
function dispatch(type: string, trusted: boolean): void {
  const trust = (ev: Event) => {
    for (const s of Object.getOwnPropertySymbols(ev)) {
      const impl = (ev as unknown as Record<symbol, { isTrusted?: boolean }>)[s];
      if (impl && typeof impl === 'object' && 'isTrusted' in impl) impl.isTrusted = trusted;
    }
  };
  window.addEventListener(type, trust, true);
  try {
    document.body.dispatchEvent(new Event(type, { bubbles: true }));
  } finally {
    window.removeEventListener(type, trust, true);
  }
}

describe('installUserActivityPing', () => {
  const install = (ping: () => void, now: () => number) => installUserActivityPing(document, ping, { intervalMs: 5_000, now });

  it('pings on the first pointer, key or wheel event and then at most once per interval', () => {
    const ping = vi.fn();
    let clock = 1_000;
    const stop = install(ping, () => clock);
    dispatch('pointerdown', true);
    expect(ping).toHaveBeenCalledTimes(1);
    dispatch('keydown', true);
    dispatch('wheel', true);
    expect(ping).toHaveBeenCalledTimes(1); // still inside the window
    clock += 5_000;
    dispatch('keydown', true);
    expect(ping).toHaveBeenCalledTimes(2);
    stop();
    clock += 5_000;
    dispatch('pointerdown', true);
    expect(ping).toHaveBeenCalledTimes(2);
  });

  it('ignores events a page script dispatched, so nothing on x.com can defer a run', () => {
    const ping = vi.fn();
    const stop = install(ping, () => 0);
    dispatch('pointerdown', false);
    dispatch('keydown', false);
    expect(ping).not.toHaveBeenCalled();
    stop();
  });
});
