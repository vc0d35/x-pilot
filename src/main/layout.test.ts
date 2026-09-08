import { describe, it, expect } from 'vitest';
import { computeLayout, HANDLE_INSET, HANDLE_SIZE, SIDEBAR_WIDTH } from './layout';

describe('computeLayout', () => {
  it('gives the sidebar its full width when open', () => {
    const l = computeLayout(1500, 950, false);
    expect(l.sidebar).toEqual({ x: 1500 - SIDEBAR_WIDTH, y: 0, width: SIDEBAR_WIDTH, height: 950 });
    expect(l.xView.width).toBe(1500 - SIDEBAR_WIDTH);
  });
  it('gives the whole window to the X view and floats a handle top-right when collapsed', () => {
    const l = computeLayout(1500, 950, true);
    expect(l.xView.width).toBe(1500);
    expect(l.sidebar).toEqual({ x: 1500 - HANDLE_SIZE - HANDLE_INSET, y: HANDLE_INSET, width: HANDLE_SIZE, height: HANDLE_SIZE });
  });
  it('never produces negative widths', () => {
    const l = computeLayout(10, 100, false);
    expect(l.xView.width).toBe(0);
    expect(l.sidebar.width).toBe(10);
  });
});
