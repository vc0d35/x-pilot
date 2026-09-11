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

/** Where the user dropped the handle, as offsets from the window's top-left. */
export interface HandlePosition {
  x: number;
  y: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.round(Math.min(hi, Math.max(lo, v)));

/**
 * A saved handle position as it applies to a window this size, or null when it does not apply at
 * all and the default top-right spot should be used: the window is too small to hold the handle
 * inside its inset, or the saved spot is off the window entirely (a smaller display since, or a
 * window moved between screens). A position that only hangs over an edge is pulled back in.
 */
export function clampHandle(width: number, height: number, handle: HandlePosition | null | undefined): HandlePosition | null {
  if (!handle) return null;
  const maxX = width - HANDLE_WIDTH - HANDLE_INSET;
  const maxY = height - HANDLE_HEIGHT - HANDLE_INSET;
  if (maxX < HANDLE_INSET || maxY < HANDLE_INSET) return null;
  const offWindow = handle.x >= width || handle.y >= height || handle.x + HANDLE_WIDTH <= 0 || handle.y + HANDLE_HEIGHT <= 0;
  if (offWindow) return null;
  return { x: clamp(handle.x, HANDLE_INSET, maxX), y: clamp(handle.y, HANDLE_INSET, maxY) };
}

export function computeLayout(
  width: number,
  height: number,
  collapsed: boolean,
  handle?: HandlePosition | null,
): { xView: Bounds; sidebar: Bounds } {
  if (collapsed) {
    const spot = clampHandle(width, height, handle);
    return {
      xView: { x: 0, y: 0, width: Math.max(0, width), height },
      sidebar: {
        x: spot ? spot.x : Math.max(0, width - HANDLE_WIDTH - HANDLE_INSET - HANDLE_RIGHT_OFFSET),
        y: spot ? spot.y : HANDLE_INSET,
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
