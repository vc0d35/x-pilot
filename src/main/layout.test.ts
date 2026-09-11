import { describe, it, expect } from 'vitest';
import { clampHandle, computeLayout, HANDLE_HEIGHT, HANDLE_INSET, HANDLE_RIGHT_OFFSET, HANDLE_WIDTH, SIDEBAR_WIDTH } from './layout';

describe('computeLayout', () => {
  it('gives the sidebar its full width when open', () => {
    const l = computeLayout(1500, 950, false);
    expect(l.sidebar).toEqual({ x: 1500 - SIDEBAR_WIDTH, y: 0, width: SIDEBAR_WIDTH, height: 950 });
    expect(l.xView.width).toBe(1500 - SIDEBAR_WIDTH);
  });
  it('gives the whole window to the X view and floats a handle top-right when collapsed', () => {
    const l = computeLayout(1500, 950, true);
    expect(l.xView.width).toBe(1500);
    expect(l.sidebar).toEqual({
      x: 1500 - HANDLE_WIDTH - HANDLE_INSET - HANDLE_RIGHT_OFFSET,
      y: HANDLE_INSET,
      width: HANDLE_WIDTH,
      height: HANDLE_HEIGHT,
    });
  });
  it('puts the handle where the user dropped it, when there is a saved spot', () => {
    const l = computeLayout(1500, 950, true, { x: 300, y: 220 });
    expect(l.sidebar).toEqual({ x: 300, y: 220, width: HANDLE_WIDTH, height: HANDLE_HEIGHT });
    // The saved spot is the handle's, not the sidebar's: expanded, it is laid out as it always was.
    expect(computeLayout(1500, 950, false, { x: 300, y: 220 }).sidebar.x).toBe(1500 - SIDEBAR_WIDTH);
  });

  it('pulls a handle hanging over an edge back inside, keeping the inset', () => {
    expect(computeLayout(1500, 950, true, { x: 1480, y: 946 }).sidebar).toMatchObject({
      x: 1500 - HANDLE_WIDTH - HANDLE_INSET,
      y: 950 - HANDLE_HEIGHT - HANDLE_INSET,
    });
    expect(computeLayout(1500, 950, true, { x: -30, y: -12 }).sidebar).toMatchObject({ x: HANDLE_INSET, y: HANDLE_INSET });
  });

  it('falls back to the default top-right spot when the saved one is off the window', () => {
    const away = computeLayout(1500, 950, true, { x: 3000, y: 220 });
    expect(away.sidebar).toEqual(computeLayout(1500, 950, true).sidebar);
    expect(away.sidebar.x).toBe(1500 - HANDLE_WIDTH - HANDLE_INSET - HANDLE_RIGHT_OFFSET);
    expect(computeLayout(1500, 950, true, { x: 300, y: -40 }).sidebar).toEqual(computeLayout(1500, 950, true).sidebar);
  });

  it('ignores a saved spot in a window too small to hold the handle inside its inset', () => {
    expect(clampHandle(100, 40, { x: 4, y: 4 })).toBeNull();
    expect(clampHandle(1500, 950, null)).toBeNull();
    // A fractional pointer position becomes whole pixels: view bounds are integers.
    expect(clampHandle(1500, 950, { x: 300.6, y: 220.2 })).toEqual({ x: 301, y: 220 });
  });

  it('never produces negative widths', () => {
    const l = computeLayout(10, 100, false);
    expect(l.xView.width).toBe(0);
    expect(l.sidebar.width).toBe(10);
  });
});
