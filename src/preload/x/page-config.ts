import { ipcRenderer, webFrame } from 'electron';
import { IPC, type PageConfig } from '../../shared/ipc';
import { applySelectorOverrides } from './adapter/selectors';

const stylesOf = (payload: unknown): string | null => {
  const css = (payload as PageConfig | null)?.styles;
  return typeof css === 'string' && css.length > 0 ? css : null;
};

const selectorsOf = (payload: unknown): Partial<Record<string, string>> => {
  const overrides = (payload as PageConfig | null)?.selectors;
  return overrides && typeof overrides === 'object' ? overrides : {};
};

/**
 * Asks main for this view's config synchronously, so the user's CSS is in the frame before the page
 * paints and the adapter's selectors are the effective ones before any tool runs, and swaps both
 * whenever main pushes a new config. A hidden window is answered with no styles.
 */
export function installPageConfig(): void {
  let key: string | null = null;
  const apply = (payload: unknown): void => {
    const css = stylesOf(payload);
    try {
      applySelectorOverrides(selectorsOf(payload));
    } catch (err) {
      console.warn('[xpilot] selector overrides could not be applied', err);
    }
    try {
      if (key !== null) {
        webFrame.removeInsertedCSS(key);
        key = null;
      }
      if (css !== null) key = webFrame.insertCSS(css);
    } catch (err) {
      console.warn('[xpilot] page styles could not be applied', err);
    }
  };
  try {
    apply(ipcRenderer.sendSync(IPC.pageConfigGet));
  } catch (err) {
    console.warn('[xpilot] page config could not be read', err);
  }
  ipcRenderer.on(IPC.pageConfigUpdate, (_event, payload: unknown) => apply(payload));
}
