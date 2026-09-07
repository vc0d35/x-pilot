import { describe, it, expect, vi } from 'vitest';
import { savePdf } from './save-pdf';
import { listLibrary, openPdf } from './library';
import { HistoryStore } from '../../history/store';
import { fail, ok } from '../../../shared/tools';

function ctx() {
  const history = new HistoryStore(':memory:');
  return {
    history,
    libraryDir: () => '/lib',
    exportPdf: vi.fn(async (url: string, outDir: string) => ({ path: `${outDir}/2026-09-07-alice-title-111.pdf`, title: 'Alice: title' })),
    openPath: vi.fn(async () => ''),
  };
}

describe('xpilot_save_article_pdf', () => {
  it('exports, records the library item and returns the path', async () => {
    const c = ctx();
    const r = await savePdf.execute({ url: 'https://twitter.com/alice/status/111?s=20' }, c);
    expect(c.exportPdf).toHaveBeenCalledWith('https://x.com/alice/status/111', '/lib');
    expect(r).toEqual(ok({ path: '/lib/2026-09-07-alice-title-111.pdf', title: 'Alice: title' }));
    expect(c.history.listLibrary()[0]).toMatchObject({ url: 'https://x.com/alice/status/111', title: 'Alice: title' });
  });
  it('rejects non-post urls and surfaces export errors', async () => {
    const c = ctx();
    expect(await savePdf.execute({ url: 'https://x.com/alice' }, c)).toEqual(fail('Not a post or article URL: https://x.com/alice'));
    c.exportPdf.mockRejectedValueOnce(new Error('No post rendered before the timeout'));
    expect(await savePdf.execute({ url: 'https://x.com/alice/status/1' }, c)).toEqual(fail('PDF export failed: No post rendered before the timeout'));
  });
});

describe('library tools', () => {
  it('lists items and opens only paths inside the library dir', async () => {
    const c = ctx();
    c.history.addLibraryItem({ postId: null, url: 'u', path: '/lib/a.pdf', title: 'A' });
    expect((await listLibrary.execute({}, c)) as { content: unknown[] }).toMatchObject({ content: [expect.objectContaining({ path: '/lib/a.pdf' })] });
    expect(await openPdf.execute({ path: '/lib/a.pdf' }, c)).toEqual(ok({ opened: true }));
    expect(await openPdf.execute({ path: '/etc/passwd' }, c)).toEqual(fail('Refusing to open a file outside the library folder'));
    c.openPath.mockResolvedValueOnce('No app');
    expect(await openPdf.execute({ path: '/lib/a.pdf' }, c)).toEqual(fail('Could not open PDF: No app'));
  });
  it('still opens an item recorded under a previous library folder', async () => {
    const c = ctx();
    c.history.addLibraryItem({ postId: null, url: 'u', path: '/old-folder/b.pdf', title: 'B' });
    expect(await openPdf.execute({ path: '/old-folder/b.pdf' }, c)).toEqual(ok({ opened: true }));
    expect(c.openPath).toHaveBeenCalledWith('/old-folder/b.pdf');
    expect(await openPdf.execute({ path: '/old-folder/c.pdf' }, c)).toEqual(fail('Refusing to open a file outside the library folder'));
  });
});
