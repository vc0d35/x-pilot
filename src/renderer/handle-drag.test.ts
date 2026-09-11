import { describe, it, expect } from 'vitest';
import { CLICK_HOLD_MS, CLICK_SLOP_PX, decideGesture } from './handle-drag';

describe('decideGesture', () => {
  it('is the click that expands the sidebar when the press barely moved and was let go quickly', () => {
    expect(decideGesture({ dx: 0, dy: 0, elapsedMs: 0 })).toBe('click');
    expect(decideGesture({ dx: 3, dy: -2, elapsedMs: 120 })).toBe('click');
  });

  it('holds the thresholds themselves to be a click, so neither edge flickers', () => {
    expect(decideGesture({ dx: CLICK_SLOP_PX, dy: 0, elapsedMs: CLICK_HOLD_MS })).toBe('click');
    expect(decideGesture({ dx: 0, dy: -CLICK_SLOP_PX, elapsedMs: CLICK_HOLD_MS })).toBe('click');
  });

  it('becomes a drag past the distance, whichever way the pointer went', () => {
    expect(decideGesture({ dx: CLICK_SLOP_PX + 1, dy: 0, elapsedMs: 20 })).toBe('drag');
    expect(decideGesture({ dx: 0, dy: -(CLICK_SLOP_PX + 1), elapsedMs: 20 })).toBe('drag');
    // Diagonally: it is the distance that counts, not either axis on its own.
    expect(decideGesture({ dx: 5, dy: 5, elapsedMs: 20 })).toBe('drag');
    expect(decideGesture({ dx: 4, dy: 4, elapsedMs: 20 })).toBe('click');
  });

  it('becomes a drag past the hold, even under a pointer that never moved', () => {
    expect(decideGesture({ dx: 0, dy: 0, elapsedMs: CLICK_HOLD_MS + 1 })).toBe('drag');
  });
});
