import type { Session } from 'electron';

/** Chromium grants a page most permissions unless the app installs a handler, so every session gets an explicit policy; x.com only needs fullscreen (video) and the sanitised clipboard write. */
export const X_SESSION_PERMISSIONS: readonly string[] = ['fullscreen', 'clipboard-sanitized-write'];

export type PermissionCallback = (granted: boolean) => void;

/** The slice of Electron's Session this module drives; unit tests feed a fake. */
export interface PermissionSessionLike {
  setPermissionRequestHandler(handler: (webContents: unknown, permission: string, callback: PermissionCallback, details: unknown) => void): void;
  setPermissionCheckHandler(handler: (webContents: unknown, permission: string, requestingOrigin: string, details: unknown) => boolean): void;
  setDevicePermissionHandler(handler: (details: unknown) => boolean): void;
  setDisplayMediaRequestHandler(handler: (request: unknown, callback: (streams: Record<string, never>) => void) => void): void;
}

export function applyPermissionPolicy(session: PermissionSessionLike, allow: readonly string[] = []): void {
  const allowed = new Set(allow);
  session.setPermissionRequestHandler((_webContents, permission, callback) => callback(allowed.has(permission)));
  session.setPermissionCheckHandler((_webContents, permission) => allowed.has(permission));
  session.setDevicePermissionHandler(() => false);
  // No video/audio in the response means "the user picked nothing": the request is denied.
  session.setDisplayMediaRequestHandler((_request, callback) => callback({}));
}

export function installPermissionHandlers(sessions: { x: Session; default: Session }): void {
  applyPermissionPolicy(sessions.x as unknown as PermissionSessionLike, X_SESSION_PERMISSIONS);
  applyPermissionPolicy(sessions.default as unknown as PermissionSessionLike, []);
}
