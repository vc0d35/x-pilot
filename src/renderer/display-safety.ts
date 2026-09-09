/** Helpers for rendering text the user did not write (model output, page text, tool arguments). */

/** Keeps the shape of a detail block but stops a wall of newlines from pushing content out of view. */
export function collapseBlankLines(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n');
}

const HOSTISH = /^(?:[a-z][a-z0-9+.-]*:)?\/{0,2}((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,})(?:[:/?#]|$)/i;

function bareHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, '');
}

/** The host a link's visible text claims to lead to, when it reads like a URL or a hostname. */
export function claimedHost(text: string): string | null {
  const m = HOSTISH.exec(text.trim());
  return m ? bareHost(m[1]) : null;
}

/**
 * The link's real host when its visible text claims a different one — the `x.com/safe` label on an
 * `evil.com` href. Returns null for honest links and for text that does not read as a destination.
 */
export function deceptiveLinkHost(text: string, href: string): string | null {
  const claimed = claimedHost(text);
  if (!claimed) return null;
  let real: string;
  try { real = bareHost(new URL(href).hostname); } catch { return null; }
  if (!real) return null;
  return claimed === real ? null : real;
}
