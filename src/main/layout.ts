export const SIDEBAR_WIDTH = 420;
/** When collapsed the sidebar view becomes a small handle floating over the top-right of the X view. */
export const HANDLE_WIDTH = 104;
export const HANDLE_HEIGHT = 32;
export const HANDLE_INSET = 8;
/** Horizontal offset from the right edge, keeping the handle clear of x.com's own top-right controls. */
export const HANDLE_RIGHT_OFFSET = 15;

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function computeLayout(
  width: number,
  height: number,
  collapsed: boolean,
): { xView: Bounds; sidebar: Bounds } {
  if (collapsed) {
    return {
      xView: { x: 0, y: 0, width: Math.max(0, width), height },
      sidebar: {
        x: Math.max(
          0,
          width - HANDLE_WIDTH - HANDLE_INSET - HANDLE_RIGHT_OFFSET,
        ),
        y: HANDLE_INSET,
        width: HANDLE_WIDTH,
        height: HANDLE_HEIGHT,
      },
    };
  }
  const side = Math.min(SIDEBAR_WIDTH, Math.max(0, width));
  return {
    xView: { x: 0, y: 0, width: Math.max(0, width - side), height },
    sidebar: { x: Math.max(0, width - side), y: 0, width: side, height },
  };
}
