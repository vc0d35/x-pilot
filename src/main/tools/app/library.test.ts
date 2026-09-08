import { describe, it, expect, vi } from 'vitest';
import { listLibrary, openPdf } from './library';
import type { AppToolCtx } from './context';

function ctx(overrides: { libraryDir?: string; hasLibraryPath?: (p: string) => boolean; items?: unknown[] } = {}) {
  const openPath = vi.fn(async () => '');
  const hasLibraryPath = vi.fn(overrides.hasLibraryPath ?? (() => false));
  const listLibraryFn = vi.fn(() => overrides.items ?? []);
  return {
    openPath,
    hasLibraryPath,
    listLibraryFn,
    value: {
      history: { hasLibraryPath, listLibrary: listLibraryFn },
      libraryDir: () => overrides.libraryDir ?? '/lib',
      openPath,
    } as unknown as AppToolCtx,
  };
}

describe('xpilot_open_pdf', () => {
  it('opens a PDF inside the library folder', async () => {
    const c = ctx();
    expect(await openPdf.execute({ path: '/lib/a.pdf' }, c.value)).toEqual({ success: true, content: { opened: true } });
    expect(c.openPath).toHaveBeenCalledWith('/lib/a.pdf');
  });

  it('refuses a non-PDF inside the library folder', async () => {
    const c = ctx();
    const r = await openPdf.execute({ path: '/lib/notes.txt' }, c.value);
    expect(r).toEqual({ success: false, error: 'Refusing to open a file that is not a PDF in the library' });
    expect(c.openPath).not.toHaveBeenCalled();
  });

  it('refuses a path that escapes the library folder', async () => {
    const c = ctx();
    const r = await openPdf.execute({ path: '/lib/../etc/secret.pdf' }, c.value);
    expect(r).toEqual({ success: false, error: 'Refusing to open a file that is not a PDF in the library' });
    expect(c.openPath).not.toHaveBeenCalled();
  });

  it('opens a recorded PDF that now lives outside the library folder', async () => {
    const c = ctx({ hasLibraryPath: (p) => p === '/old/a.pdf' });
    expect((await openPdf.execute({ path: '/old/a.pdf' }, c.value)).success).toBe(true);
  });

  it('reports the opener error', async () => {
    const c = ctx();
    c.openPath.mockResolvedValueOnce('no application');
    const r = await openPdf.execute({ path: '/lib/a.pdf' }, c.value);
    expect(r).toMatchObject({ success: false });
  });
});

describe('xpilot_list_library', () => {
  it('passes the limit through', async () => {
    const c = ctx({ items: [{ path: '/lib/a.pdf' }] });
    expect(await listLibrary.execute({ limit: 3 }, c.value)).toEqual({ success: true, content: [{ path: '/lib/a.pdf' }] });
    expect(c.listLibraryFn).toHaveBeenCalledWith(3);
  });
});
