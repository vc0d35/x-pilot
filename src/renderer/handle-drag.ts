/** How far and how long a press on the collapsed handle may go and still be the click that expands it. */
export const CLICK_SLOP_PX = 6;
export const CLICK_HOLD_MS = 250;

/**
 * What a press on the handle turned out to be. Released near where it went down and soon enough,
 * it is the click that opens the sidebar; past either threshold the user is carrying the pill
 * somewhere, and a hold that has not moved at all counts too — that is how a drag is started before
 * the pointer goes anywhere.
 */
export function decideGesture(press: { dx: number; dy: number; elapsedMs: number }): 'click' | 'drag' {
  return Math.hypot(press.dx, press.dy) <= CLICK_SLOP_PX && press.elapsedMs <= CLICK_HOLD_MS ? 'click' : 'drag';
}
