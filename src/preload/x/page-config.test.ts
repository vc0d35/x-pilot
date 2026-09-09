// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The preload's own half of both features, with `electron` stood in for. This is the file the
 * stylesheet and the selector overrides ultimately run through, and its two arms fail independently.
 */
const sendSync = vi.fn();
const on = vi.fn();
const insertCSS = vi.fn((css: string) => `key:${css.length}`);
const removeInsertedCSS = vi.fn();

vi.mock('electron', () => ({
  ipcRenderer: {
    sendSync: (...args: unknown[]) => sendSync(...args),
    on: (...args: unknown[]) => on(...args),
  },
  webFrame: {
    insertCSS: (css: string) => insertCSS(css),
    removeInsertedCSS: (key: string) => removeInsertedCSS(key),
  },
}));

const { installPageConfig } = await import('./page-config');
const { SEL, applySelectorOverrides } = await import('./adapter/selectors');
const { SELECTOR_DEFAULTS } = await import('../../shared/selectors');
const { IPC } = await import('../../shared/ipc');

/** Whatever main pushed after installation, as the update listener would receive it. */
const push = (payload: unknown) => {
  const listener = on.mock.calls.find((c) => c[0] === IPC.pageConfigUpdate)?.[1] as (e: unknown, p: unknown) => void;
  listener({}, payload);
};

/** The preview half of the same wiring: the sheet a tool shows while it waits on the user. */
const preview = (css: string | null) => {
  const listener = on.mock.calls.find((c) => c[0] === IPC.pageConfigPreview)?.[1] as (e: unknown, p: unknown) => void;
  listener({}, { css });
};

beforeEach(() => {
  vi.clearAllMocks();
  insertCSS.mockImplementation((css: string) => `key:${css.length}`);
  removeInsertedCSS.mockImplementation(() => {});
  applySelectorOverrides({});
  document.body.innerHTML = '';
});

describe('installPageConfig', () => {
  it('asks for the config synchronously and inserts the CSS before anything else runs', () => {
    const order: string[] = [];
    sendSync.mockImplementation(() => {
      order.push('sendSync');
      return { styles: 'a { color: red }', selectors: {} };
    });
    insertCSS.mockImplementation(() => {
      order.push('insertCSS');
      return 'k1';
    });
    installPageConfig();
    expect(sendSync).toHaveBeenCalledWith(IPC.pageConfigGet);
    // The whole point of sendSync: the sheet is in the frame before this function returns.
    expect(order).toEqual(['sendSync', 'insertCSS']);
  });

  it('swaps the sheet on an update, taking the old one back off first', () => {
    sendSync.mockReturnValue({ styles: 'a {}', selectors: {} });
    installPageConfig();
    push({ styles: 'b { color: blue }', selectors: {} });
    expect(removeInsertedCSS).toHaveBeenCalledWith('key:4');
    expect(insertCSS).toHaveBeenLastCalledWith('b { color: blue }');
  });

  it('takes the sheet off and inserts nothing when the styles go away', () => {
    sendSync.mockReturnValue({ styles: 'a {}', selectors: {} });
    installPageConfig();
    insertCSS.mockClear();
    push({ styles: null, selectors: {} });
    expect(removeInsertedCSS).toHaveBeenCalledWith('key:4');
    expect(insertCSS).not.toHaveBeenCalled();
  });

  it('applies selector overrides, and a hidden window with no styles still gets them', () => {
    sendSync.mockReturnValue({ styles: null, selectors: { article: '.post' } });
    installPageConfig();
    expect(SEL.article).toBe('.post');
    expect(insertCSS).not.toHaveBeenCalled();
  });

  it('falls back to the shipped default for an override the browser cannot parse', () => {
    sendSync.mockReturnValue({ styles: null, selectors: { article: 'div:has(((', tweetText: '.fine' } });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    installPageConfig();
    // A value like this alone breaks `${SEL.a}, ${SEL.b}` for every call site that combines them.
    expect(SEL.article).toBe(SELECTOR_DEFAULTS.article);
    expect(SEL.tweetText).toBe('.fine');
    expect(document.querySelectorAll(`${SEL.trend}, ${SEL.newsArticle}`)).toHaveLength(0);
    warn.mockRestore();
  });

  it('still applies the styles when the selectors throw, and the reverse', () => {
    sendSync.mockImplementation(() => {
      throw new Error('main is not answering');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => installPageConfig()).not.toThrow();
    insertCSS.mockImplementation(() => {
      throw new Error('bad sheet');
    });
    push({ styles: 'a {}', selectors: { article: '.post' } });
    expect(SEL.article).toBe('.post');
    warn.mockRestore();
  });

  it('inserts a preview under its own key, replaces it, and takes it back off', () => {
    sendSync.mockReturnValue({ styles: 'a {}', selectors: {} });
    installPageConfig();
    insertCSS.mockClear();
    removeInsertedCSS.mockClear();
    preview('p { color: pink }');
    expect(insertCSS).toHaveBeenLastCalledWith('p { color: pink }');
    // The file sheet is left where it is: the preview is a second sheet over it, not a swap.
    expect(removeInsertedCSS).not.toHaveBeenCalled();
    preview('p { color: rebeccapurple }');
    expect(removeInsertedCSS).toHaveBeenCalledWith('key:17');
    expect(insertCSS).toHaveBeenLastCalledWith('p { color: rebeccapurple }');
    insertCSS.mockClear();
    preview(null);
    expect(removeInsertedCSS).toHaveBeenLastCalledWith('key:26');
    expect(insertCSS).not.toHaveBeenCalled();
  });

  it('re-inserts the preview after a file-style change, so it keeps winning', () => {
    sendSync.mockReturnValue({ styles: 'a {}', selectors: {} });
    installPageConfig();
    preview('p { color: pink }');
    insertCSS.mockClear();
    push({ styles: 'b { color: blue }', selectors: {} });
    expect(insertCSS.mock.calls.map((c) => c[0])).toEqual(['b { color: blue }', 'p { color: pink }']);
  });

  it('keeps the file styles when a preview cannot be inserted', () => {
    sendSync.mockReturnValue({ styles: 'a {}', selectors: {} });
    installPageConfig();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    insertCSS.mockImplementation(() => {
      throw new Error('bad sheet');
    });
    expect(() => preview('p { color: pink }')).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('ignores a payload that is not a config at all', () => {
    sendSync.mockReturnValue(null);
    installPageConfig();
    expect(insertCSS).not.toHaveBeenCalled();
    expect(SEL.article).toBe(SELECTOR_DEFAULTS.article);
  });
});
