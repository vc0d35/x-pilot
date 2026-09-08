import { describe, it, expect } from 'vitest';
import { computeLayout, HANDLE_HEIGHT, HANDLE_INSET, HANDLE_RIGHT_OFFSET, HANDLE_WIDTH, SIDEBAR_WIDTH } from './layout';

describe('computeLayout', () => {
  it('gives the sidebar its full width when open', () => {
    const l = computeLayout(1500, 950, false);
    expect(l.sidebar).toEqual({ x: 1500 - SIDEBAR_WIDTH, y: 0, width: SIDEBAR_WIDTH, height: 950 });
    expect(l.xView.width).toBe(1500 - SIDEBAR_WIDTH);
  });
  it('gives the whole window to the X view and floats a handle top-right when collapsed', () => {
    const l = computeLayout(1500, 950, true);
    expect(l.xView.width).toBe(1500);
    expect(l.sidebar).toEqual({ x: 1500 - HANDLE_WIDTH - HANDLE_INSET - HANDLE_RIGHT_OFFSET, y: HANDLE_INSET, width: HANDLE_WIDTH, height: HANDLE_HEIGHT });
  });
  it('never produces negative widths', () => {
    const l = computeLayout(10, 100, false);
    expect(l.xView.width).toBe(0);
    expect(l.sidebar.width).toBe(10);
  });
});
