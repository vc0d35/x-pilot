import { describe, it, expect, vi } from 'vitest';
import { IPC } from '../../shared/ipc';
import { registerPageConfigIpc, type PageConfigIpcEvent } from './ipc';

function harness(opts: { css?: string; overrides?: Record<string, string> } = {}) {
  const handlers = new Map<string, (event: PageConfigIpcEvent, payload: unknown) => void>();
  const styleListeners = new Set<(css: string) => void>();
  const selectorListeners = new Set<() => void>();
  let css = opts.css ?? 'a { color: red }';
  let overrides: Record<string, string> = opts.overrides ?? {};
  const send = vi.fn();
  registerPageConfigIpc({
    ipc: { on: (channel, listener) => void handlers.set(channel, listener) },
    isXContents: (id) => id === 1 || id === 2,
    isVisibleContents: (id) => id === 1,
    styles: {
      get: () => css,
      onChange: (cb) => {
        styleListeners.add(cb);
        return () => styleListeners.delete(cb);
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
    changeSelectors(next: Record<string, string>) {
      overrides = next;
      for (const cb of selectorListeners) cb();
    },
  };
}

describe('registerPageConfigIpc', () => {
  it('gives the visible view the styles and the selector overrides', () => {
    expect(harness({ overrides: { article: '.post' } }).ask(1)).toEqual({ styles: 'a { color: red }', selectors: { article: '.post' } });
  });

  it('gives a hidden X window no styles but the same selectors, so both read the page the same way', () => {
    expect(harness({ overrides: { article: '.post' } }).ask(2)).toEqual({ styles: null, selectors: { article: '.post' } });
  });

  it('answers a sender that is not one of our X views, without config', () => {
    // Answering is the point: an unanswered sendSync would hang the page that asked.
    expect(harness().ask(99)).toBeNull();
  });

  it('pushes a style change to the visible view and nothing but selectors to the hidden one', () => {
    const h = harness();
    h.changeStyles('b { color: blue }');
    expect(h.send).toHaveBeenCalledWith(1, IPC.pageConfigUpdate, { styles: 'b { color: blue }', selectors: {} });
    expect(h.send).toHaveBeenCalledWith(2, IPC.pageConfigUpdate, { styles: null, selectors: {} });
  });

  it('pushes a selector change to every X view', () => {
    const h = harness();
    h.changeSelectors({ article: '.post' });
    expect(h.send).toHaveBeenCalledWith(1, IPC.pageConfigUpdate, { styles: 'a { color: red }', selectors: { article: '.post' } });
    expect(h.send).toHaveBeenCalledWith(2, IPC.pageConfigUpdate, { styles: null, selectors: { article: '.post' } });
  });
});
