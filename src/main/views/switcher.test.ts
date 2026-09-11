import { describe, it, expect, vi } from 'vitest';
import { createViewSwitcher } from './switcher';

/** A store and a canvas with no disk and no Chromium: switching is bookkeeping, and this is it. */
function harness(opts: { views?: Record<string, string[]>; active?: string | null; showFailure?: string | null } = {}) {
  const views: Record<string, string[]> = opts.views ?? {};
  let active: string | null = opts.active ?? null;
  const persisted: (string | null)[] = [];
  const hide = vi.fn(() => {
    active = null;
  });
  const show = vi.fn(async (view: string) => {
    if (opts.showFailure) return opts.showFailure;
    active = view;
    return null;
  });
  const store = {
    list: () => Object.entries(views).map(([name, files]) => ({ name, files: files.length, hasIndex: files.includes('index.html') })),
    exists: (view: string) => view in views,
    hasIndex: (view: string) => (views[view] ?? []).includes('index.html'),
    delete: (view: string) => delete views[view],
  };
  const switcher = createViewSwitcher({
    store,
    active: () => active,
    show,
    hide,
    persist: (view) => {
      persisted.push(view);
    },
  });
  return { switcher, show, hide, persisted, views, active: () => active };
}

describe('list', () => {
  it('names every view, how many files it has, whether it can be loaded, and which one is on screen', () => {
    const h = harness({ views: { cards: ['index.html', 'app.js'], half: ['app.js'] }, active: 'cards' });
    expect(h.switcher.list()).toEqual([
      { name: 'cards', files: 2, hasIndex: true, active: true },
      { name: 'half', files: 1, hasIndex: false, active: false },
    ]);
  });

  it('marks nothing active when the X page is what is on screen', () => {
    const h = harness({ views: { cards: ['index.html'] } });
    expect(h.switcher.list().map((v) => v.active)).toEqual([false]);
  });
});

describe('activate', () => {
  it('shows the view and remembers it, with nothing to confirm', async () => {
    const h = harness({ views: { cards: ['index.html'] } });
    expect(await h.switcher.activate('cards')).toEqual([{ name: 'cards', files: 1, hasIndex: true, active: true }]);
    expect(h.show).toHaveBeenCalledWith('cards');
    expect(h.persisted).toEqual(['cards']);
  });

  it('refuses a view that is not there, one with no index.html, and a name that is not one', async () => {
    const h = harness({ views: { half: ['app.js'] } });
    await expect(h.switcher.activate('missing')).rejects.toThrow('There is no view called missing');
    await expect(h.switcher.activate('half')).rejects.toThrow('no index.html');
    await expect(h.switcher.activate('../etc')).rejects.toThrow('Not a view name');
    expect(h.show).not.toHaveBeenCalled();
    expect(h.persisted).toEqual([]);
  });

  it('remembers nothing when the canvas could not show it', async () => {
    const h = harness({ views: { cards: ['index.html'] }, showFailure: 'ERR_FAILED' });
    await expect(h.switcher.activate('cards')).rejects.toThrow('cards could not be shown: ERR_FAILED');
    expect(h.persisted).toEqual([]);
  });
});

describe('deactivate', () => {
  it('takes the view off the screen and forgets it for the next start', () => {
    const h = harness({ views: { cards: ['index.html'] }, active: 'cards' });
    expect(h.switcher.deactivate()).toEqual([{ name: 'cards', files: 1, hasIndex: true, active: false }]);
    expect(h.hide).toHaveBeenCalledTimes(1);
    expect(h.persisted).toEqual([null]);
  });
});

describe('remove', () => {
  it('deletes a view nobody is looking at without touching the canvas', () => {
    const h = harness({ views: { cards: ['index.html'], other: ['index.html'] }, active: 'other' });
    expect(h.switcher.remove('cards')).toEqual([{ name: 'other', files: 1, hasIndex: true, active: true }]);
    expect(h.hide).not.toHaveBeenCalled();
    expect(h.persisted).toEqual([]);
  });

  it('takes the view on screen off first, so the canvas is never left on files that are gone', () => {
    const h = harness({ views: { cards: ['index.html'] }, active: 'cards' });
    expect(h.switcher.remove('cards')).toEqual([]);
    expect(h.hide).toHaveBeenCalledTimes(1);
    expect(h.persisted).toEqual([null]);
    expect(h.views).toEqual({});
  });

  it('refuses a name that is not a view name rather than reaching the store', () => {
    const h = harness({ views: { cards: ['index.html'] } });
    expect(() => h.switcher.remove('..')).toThrow('Not a view name');
    expect(h.views).toEqual({ cards: ['index.html'] });
  });
});
