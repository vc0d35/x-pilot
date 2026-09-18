import { mediaUrl } from '../shared/media-url';
import type { ToolImage } from '../shared/tools';

export type ImageDetail = 'low' | 'medium' | 'high';

const IMAGE_HOST = 'pbs.twimg.com';
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
/** The paths where X's CDN takes a `name=` rendition; elsewhere (avatars, banners) the URL names its own size. */
const SIZED_PATH = /^\/(media|card_img|amplify_video_thumb|ext_tw_video_thumb|tweet_video_thumb)\//;
const RENDITION: Record<ImageDetail, string> = { low: 'small', medium: 'medium', high: 'large' };

/**
 * The URL to fetch for a picture a post carries, or null when it is not one we will fetch. Only
 * X's image CDN, over https, through the same gate every media URL passes; the rendition is chosen
 * here so a full-size original is never what the model is sent by default.
 */
export function imageRequestUrl(value: string, detail: ImageDetail = 'medium'): string | null {
  const allowed = mediaUrl(value);
  if (!allowed) return null;
  const url = new URL(allowed);
  if (url.hostname.toLowerCase() !== IMAGE_HOST || url.username || url.password || url.port) return null;
  if (SIZED_PATH.test(url.pathname)) url.searchParams.set('name', RENDITION[detail]);
  return url.toString();
}

export interface FetchImageDeps {
  fetch: typeof fetch;
}

/**
 * Fetches one picture from X's CDN with no cookies and no redirects, and answers with it as base64.
 * The response is page-adjacent input like any other: the type has to be an image we know, and the
 * size is capped before and after the body is read, since a length header is only a claim.
 */
export async function fetchImage(value: string, detail: ImageDetail, deps: FetchImageDeps, signal?: AbortSignal): Promise<ToolImage> {
  const url = imageRequestUrl(value, detail);
  if (!url) throw new Error('Not an image on X’s image CDN (https://pbs.twimg.com/…)');
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const res = await deps.fetch(url, {
    redirect: 'error',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!res.ok) throw new Error(`The image could not be fetched (HTTP ${res.status})`);
  const mimeType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!IMAGE_TYPES.has(mimeType)) throw new Error(`Not an image the model can take (${mimeType || 'no content type'})`);
  if (Number(res.headers.get('content-length') ?? 0) > IMAGE_MAX_BYTES) throw new Error('The image is larger than 5 MB');
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > IMAGE_MAX_BYTES) throw new Error('The image is larger than 5 MB');
  if (bytes.length === 0) throw new Error('The image came back empty');
  return { mimeType, data: bytes.toString('base64') };
}
