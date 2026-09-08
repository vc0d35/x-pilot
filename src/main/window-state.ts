export interface WindowBounds { x: number; y: number; width: number; height: number }
export interface DisplayArea { x: number; y: number; width: number; height: number }

export const DEFAULT_BOUNDS: WindowBounds = { x: 0, y: 0, width: 1500, height: 950 };
const MIN_WIDTH = 1000;
const MIN_HEIGHT = 600;
const MIN_VISIBLE = 200; // px of the window that must overlap a display in each axis

function overlap(a: WindowBounds, d: DisplayArea): { w: number; h: number } {
  const w = Math.min(a.x + a.width, d.x + d.width) - Math.max(a.x, d.x);
  const h = Math.min(a.y + a.height, d.y + d.height) - Math.max(a.y, d.y);
  return { w, h };
}

/** Saved bounds are reused only if they are a sane size and visibly on one of the current displays. */
export function pickInitialBounds(saved: WindowBounds | null | undefined, displays: DisplayArea[]): WindowBounds {
  if (!saved || saved.width < MIN_WIDTH || saved.height < MIN_HEIGHT) return DEFAULT_BOUNDS;
  const visible = displays.some((d) => { const o = overlap(saved, d); return o.w >= MIN_VISIBLE && o.h >= MIN_VISIBLE; });
  return visible ? saved : DEFAULT_BOUNDS;
}
