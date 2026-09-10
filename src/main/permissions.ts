import type { Session } from 'electron';
import { decideNavigation } from './navigation/policy';

/** Chromium grants a page most permissions unless the app installs a handler, so every session gets an explicit policy; x.com only needs fullscreen (video) and the sanitised clipboard write. */
export const X_SESSION_PERMISSIONS: readonly string[] = ['fullscreen', 'clipboard-sanitized-write'];

export type PermissionCallback = (granted: boolean) => void;

/** What Electron hands the two handlers; a third-party iframe arrives here with isMainFrame false. */
export interface PermissionDetails {
  requestingUrl?: string;
  isMainFrame?: boolean;
}

/** The slice of Electron's Session this module drives; unit tests feed a fake. */
export interface PermissionSessionLike {
  setPermissionRequestHandler(
    handler: (webContents: unknown, permission: string, callback: PermissionCallback, details: PermissionDetails) => void,
  ): void;
  setPermissionCheckHandler(
    handler: (webContents: unknown, permission: string, requestingOrigin: string, details: PermissionDetails) => boolean,
  ): void;
  setDevicePermissionHandler(handler: (details: unknown) => boolean): void;
  setDisplayMediaRequestHandler(handler: (request: unknown, callback: (streams: Record<string, never>) => void) => void): void;
}

/** Only an https page on an allowlisted host is X itself; everything else in the session is third-party. */
export function isAllowedPermissionOrigin(url: string | undefined, allowHosts: string[]): boolean {
  return !!url && decideNavigation(url, allowHosts) === 'allow';
}

export function applyPermissionPolicy(
  session: PermissionSessionLike,
  allow: readonly string[] = [],
  isAllowedOrigin: (url: string | undefined) => boolean = () => false,
): void {
  const allowed = new Set(allow);
  // The permission name alone is not enough: the same session carries login popups, hidden views,
  // the PDF window and every third-party iframe inside them.
  const ok = (permission: string, url: string | undefined, details: PermissionDetails | undefined) =>
    allowed.has(permission) && details?.isMainFrame !== false && isAllowedOrigin(url);
  session.setPermissionRequestHandler((_webContents, permission, callback, details) =>
    callback(ok(permission, details?.requestingUrl, details)),
  );
  session.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => ok(permission, requestingOrigin, details));
  session.setDevicePermissionHandler(() => false);
  // No video/audio in the response means "the user picked nothing": the request is denied.
  session.setDisplayMediaRequestHandler((_request, callback) => callback({}));
}

export function installPermissionHandlers(sessions: {
  x: Session;
  default: Session;
  /** The session the custom-view canvas runs in: agent-written code, so nothing at all is granted. */
  views: Session;
  allowHosts: () => string[];
}): void {
  applyPermissionPolicy(sessions.x, X_SESSION_PERMISSIONS, (url) => isAllowedPermissionOrigin(url, sessions.allowHosts()));
  applyPermissionPolicy(sessions.default, []);
  applyPermissionPolicy(sessions.views, []);
}
