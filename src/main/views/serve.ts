import { contentTypeFor, APP_SCHEME } from '../hardening';
import { VIEW_ENTRY_FILE } from '../../shared/views';
import { resolveViewFile } from './store';

export const VIEWS_HOST = 'views';
export const LIB_HOST = 'lib';

/**
 * What a view page may do. It is our own code, but it was written by a model from what a page said,
 * so it gets no network of its own: the X view underneath, reached through the bridge, is the only
 * source of data, and pictures and video come from X's own CDN because that is where the posts it
 * is rendering live. Scripts come from the view itself and the library shelf, and nothing may be
 * framed, submitted or rebased.
 */
export const VIEW_CSP = [
  "default-src 'none'",
  "script-src 'self' xpilot://lib",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.twimg.com",
  'media-src blob: https://*.twimg.com https://video.twimg.com',
  "font-src 'self' xpilot://lib data:",
  "connect-src 'none'",
  "worker-src 'self' blob:",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

/**
 * The library shelf: a fixed map of names to files under `node_modules`, so a view can `import`
 * something substantial without a network and without us bundling it into every view. Names are
 * matched exactly — there is no path to contain — and three.module.js pulls in three.core.js
 * relative to itself, which is why both are on the shelf.
 */
export const LIB_FILES: Record<string, string> = {
  'three.module.js': 'three/build/three.module.js',
  'three.core.js': 'three/build/three.core.js',
  'OrbitControls.js': 'three/examples/jsm/controls/OrbitControls.js',
};

/** The addons are published against the bare `three` specifier, which only an import map resolves;
 * an import map is an inline script and the view CSP has no `'unsafe-inline'`, so the one specifier
 * is rewritten to the shelf's own module as the file is served. */
export function rewriteBareThreeImports(source: string): string {
  return source.replace(/(\bfrom\s*)['"]three['"]/g, "$1'./three.module.js'");
}

export function viewUrl(view: string, path: string = VIEW_ENTRY_FILE): string {
  return `${APP_SCHEME}://${VIEWS_HOST}/${view}/${path}`;
}

/** The `xpilot://views/<name>/` prefix a canvas showing `view` may navigate inside, and nowhere else. */
export function viewOrigin(view: string): string {
  return `${APP_SCHEME}://${VIEWS_HOST}/${view}/`;
}

function pathnameOf(requestUrl: string, host: string): string | null {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${APP_SCHEME}:` || url.hostname !== host) return null;
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  return pathname.includes('\0') ? null : pathname;
}

export interface ViewRequest {
  view: string;
  path: string;
  file: string;
  contentType: string;
}

/**
 * Maps `xpilot://views/<name>/<path>` onto a file in the store. A directory-shaped request gets the
 * view's index.html; everything else — another host, a name that is not a view, a path that is not
 * one of ours — returns null, and the handler answers 404.
 */
export function resolveViewRequest(root: string, requestUrl: string): ViewRequest | null {
  const pathname = pathnameOf(requestUrl, VIEWS_HOST);
  if (pathname === null) return null;
  const parts = pathname.split('/').filter((p) => p !== '');
  const view = parts.shift();
  if (!view) return null;
  const path = parts.length === 0 || pathname.endsWith('/') ? [...parts, VIEW_ENTRY_FILE].join('/') : parts.join('/');
  const file = resolveViewFile(root, view, path);
  if (!file) return null;
  return { view, path, file, contentType: contentTypeFor(file) };
}

/** Maps `xpilot://lib/<file>` onto the shelf. Only the exact names on it resolve. */
export function resolveLibRequest(nodeModulesDir: string, requestUrl: string): { file: string; contentType: string; name: string } | null {
  const pathname = pathnameOf(requestUrl, LIB_HOST);
  if (pathname === null) return null;
  const name = pathname.replace(/^\//, '');
  const relative = Object.prototype.hasOwnProperty.call(LIB_FILES, name) ? LIB_FILES[name] : undefined;
  if (!relative) return null;
  return { name, file: `${nodeModulesDir}/${relative}`, contentType: contentTypeFor(name) };
}
