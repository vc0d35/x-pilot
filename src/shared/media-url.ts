/**
 * X serves every picture, poster and avatar from its own CDN, so a media URL that reaches a post is
 * only ever a twimg one. Every URL on a post is page-controlled and ends up in a prompt, in a
 * persisted row and in an `<img>` a custom view renders, so all of them go through this one gate
 * before they are kept: https, and a host X actually serves from. Anything else is dropped, never
 * rewritten — a URL we had to repair to make it pass is a URL we did not understand.
 */
export const MEDIA_URL_MAX = 512;

const MEDIA_HOSTS = new Set(['pbs.twimg.com', 'video.twimg.com', 'abs.twimg.com']);

/** The URL if it is one we will hand on, `undefined` otherwise. */
export function mediaUrl(value: string | null | undefined): string | undefined {
  if (!value || value.length > MEDIA_URL_MAX) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:') return undefined;
  // `hostname` is the parsed host, so `twimg.com.evil.test` and `evil.test/pbs.twimg.com` both fail
  // here rather than matching as substrings.
  const host = url.hostname.toLowerCase();
  return MEDIA_HOSTS.has(host) || host.endsWith('.twimg.com') ? value : undefined;
}
