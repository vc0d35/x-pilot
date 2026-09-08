import { describe, it, expect } from 'vitest';
import { pickInitialBounds, DEFAULT_BOUNDS } from './window-state';

const laptop = { x: 0, y: 0, width: 1512, height: 982 };
const external = { x: 1512, y: -200, width: 2560, height: 1440 };

describe('pickInitialBounds', () => {
  it('uses saved bounds when they sit on a current display', () => {
    const saved = { x: 100, y: 50, width: 1400, height: 900 };
    expect(pickInitialBounds(saved, [laptop])).toEqual(saved);
    const onExternal = { x: 1600, y: 0, width: 1500, height: 950 };
    expect(pickInitialBounds(onExternal, [laptop, external])).toEqual(onExternal);
  });
  it('falls back to defaults when the saved position is off every display', () => {
    const onExternal = { x: 1600, y: 0, width: 1500, height: 950 };
    expect(pickInitialBounds(onExternal, [laptop])).toEqual(DEFAULT_BOUNDS);
    expect(pickInitialBounds(null, [laptop])).toEqual(DEFAULT_BOUNDS);
  });
  it('rejects bounds that are too small or barely overlap a display', () => {
    expect(pickInitialBounds({ x: 0, y: 0, width: 200, height: 100 }, [laptop])).toEqual(DEFAULT_BOUNDS);
    expect(pickInitialBounds({ x: 1480, y: 950, width: 1500, height: 950 }, [laptop])).toEqual(DEFAULT_BOUNDS);
  });
});
