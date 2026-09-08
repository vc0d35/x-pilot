export const SIDEBAR_WIDTH = 420;
/** When collapsed the sidebar view becomes a small handle floating over the top-right of the X view. */
export const HANDLE_SIZE = 36;
export const HANDLE_INSET = 8;

export interface Bounds { x: number; y: number; width: number; height: number }

/** Splits the window between the X view (left) and the sidebar (right); a collapsed sidebar takes no space. */
export function computeLayout(width: number, height: number, collapsed: boolean): { xView: Bounds; sidebar: Bounds } {
  if (collapsed) {
    return {
      xView: { x: 0, y: 0, width: Math.max(0, width), height },
      sidebar: { x: Math.max(0, width - HANDLE_SIZE - HANDLE_INSET), y: HANDLE_INSET, width: HANDLE_SIZE, height: HANDLE_SIZE },
    };
  }
  const side = Math.min(SIDEBAR_WIDTH, Math.max(0, width));
  return {
    xView: { x: 0, y: 0, width: Math.max(0, width - side), height },
    sidebar: { x: Math.max(0, width - side), y: 0, width: side, height },
  };
}
