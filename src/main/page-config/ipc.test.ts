import { describe, it, expect, vi } from 'vitest';
import { IPC } from '../../shared/ipc';
import { registerPageConfigIpc, type PageConfigIpcEvent } from './ipc';

function harness(opts: { css?: string; overrides?: Record<string, string>; throws?: boolean } = {}) {
  const handlers = new Map<string, (event: PageConfigIpcEvent, payload: unknown) => void>();
  const styleListeners = new Set<(css: string) => void>();
  const previewListeners = new Set<(css: string | null) => void>();
  const selectorListeners = new Set<() => void>();
  let css = opts.css ?? 'a { color: red }';
  let overrides: Record<string, string> = opts.overrides ?? {};
  const send = vi.fn();
  registerPageConfigIpc({
    ipc: { on: (channel, listener) => void handlers.set(channel, listener) },
    isXContents: (id) => id === 1 || id === 2,
    isVisibleContents: (id) => id === 1,
    styles: {
      get: () => {
        if (opts.throws) throw new Error('the profile is unreadable');
        return css;
      },
      onChange: (cb) => {
        styleListeners.add(cb);
        return () => styleListeners.delete(cb);
      },
      onPreview: (cb) => {
        previewListeners.add(cb);
        return () => previewListeners.delete(cb);
      },
    },
    selectors: {
      overrides: () => overrides,
      onChange: (cb) => {
        selectorListeners.add(cb);
        return () => selectorListeners.delete(cb);
      },
    },
    xContentsIds: () => [1, 2],
    send,
  });
  return {
    send,
    ask(id: number): unknown {
      const event: PageConfigIpcEvent = { sender: { id }, returnValue: 'unanswered' };
      handlers.get(IPC.pageConfigGet)!(event, undefined);
      return event.returnValue;
    },
    changeStyles(next: string) {
      css = next;
      for (const cb of styleListeners) cb(next);
    },
    preview(css: string | null) {
      for (const cb of previewListeners) cb(css);
    },
    changeSelectors(next: Record<string, string>) {
      overrides = next;
      for (const cb of selectorListeners) cb();
    },
  };
}

describe('registerPageConfigIpc', () => {
  it('gives the visible view the styles and the selector overrides', () => {
    expect(harness({ overrides: { article: '.post' } }).ask(1)).toEqual({
      view: 'visible',
      styles: 'a { color: red }',
      selectors: { article: '.post' },
    });
  });

  it('gives a hidden X window no styles but the same selectors, so both read the page the same way', () => {
    expect(harness({ overrides: { article: '.post' } }).ask(2)).toEqual({ view: 'hidden', styles: null, selectors: { article: '.post' } });
  });

  it('answers a sender that is not one of our X views, without config', () => {
    // Answering is the point: an unanswered sendSync would hang the page that asked.
    expect(harness().ask(99)).toBeNull();
  });

  it('pushes a style change to the visible view and nothing but selectors to the hidden one', () => {
    const h = harness();
    h.changeStyles('b { color: blue }');
    expect(h.send).toHaveBeenCalledWith(1, IPC.pageConfigUpdate, { view: 'visible', styles: 'b { color: blue }', selectors: {} });
    expect(h.send).toHaveBeenCalledWith(2, IPC.pageConfigUpdate, { view: 'hidden', styles: null, selectors: {} });
  });

  it('sends a preview to the visible view alone, and takes it off the same way', () => {
    const h = harness();
    h.preview('b { color: blue }');
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.send).toHaveBeenCalledWith(1, IPC.pageConfigPreview, { css: 'b { color: blue }' });
    h.preview(null);
    expect(h.send).toHaveBeenLastCalledWith(1, IPC.pageConfigPreview, { css: null });
  });

  it('answers with no config rather than throwing when a store cannot read its file', () => {
    // A sendSync the handler failed to answer would block the page before it renders, for good.
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(harness({ throws: true }).ask(1)).toEqual({ view: 'hidden', styles: null, selectors: {} });
    error.mockRestore();
  });

  it('pushes a selector change to every X view', () => {
    const h = harness();
    h.changeSelectors({ article: '.post' });
    expect(h.send).toHaveBeenCalledWith(1, IPC.pageConfigUpdate, {
      view: 'visible',
      styles: 'a { color: red }',
      selectors: { article: '.post' },
    });
    expect(h.send).toHaveBeenCalledWith(2, IPC.pageConfigUpdate, { view: 'hidden', styles: null, selectors: { article: '.post' } });
  });
});
