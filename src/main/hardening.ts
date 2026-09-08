export interface HardenableContents {
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }): void;
  on(event: 'will-attach-webview', listener: (e: { preventDefault(): void }) => void): unknown;
}

/**
 * The baseline every WebContents gets the moment it is created: no new windows, no <webview>.
 * Views that legitimately open windows (the X view and its login popups) attach their own
 * handler afterwards, which replaces this one.
 */
export function hardenWebContents(contents: HardenableContents): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-attach-webview', (e) => e.preventDefault());
}
