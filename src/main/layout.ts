export const SIDEBAR_WIDTH = 420;
export const SIDEBAR_COLLAPSED_WIDTH = 0;

export interface Bounds { x: number; y: number; width: number; height: number }

/** Splits the window between the X view (left) and the sidebar (right); a collapsed sidebar takes no space. */
export function computeLayout(width: number, height: number, collapsed: boolean): { xView: Bounds; sidebar: Bounds } {
  const side = Math.min(collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH, Math.max(0, width));
  return {
    xView: { x: 0, y: 0, width: Math.max(0, width - side), height },
    sidebar: { x: Math.max(0, width - side), y: 0, width: side, height },
  };
}
