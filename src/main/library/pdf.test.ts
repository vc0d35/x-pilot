import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportPdf, type PdfWindow } from './pdf';

const outDir = () => mkdtempSync(join(tmpdir(), 'xpilot-pdf-'));
const POST = 'https://x.com/alice/status/111';

function fakeWindow(overrides: Partial<PdfWindow> = {}): PdfWindow {
  return {
    loadURL: vi.fn(async () => {}),
    executeJavaScript: vi.fn(async () => ({ title: 'Alice: title', author: 'alice', id: '111' })),
    printToPDF: vi.fn(async () => Buffer.from('%PDF-1.4 fake')),
    getURL: () => POST,
    destroy: vi.fn(),
    ...overrides,
  };
}

describe('exportPdf', () => {
  it('writes a named PDF and returns the path and title', async () => {
    const win = fakeWindow();
    const dir = outDir();
    const result = await exportPdf({ url: POST, outDir: dir }, { createWindow: () => win });
    expect(result.title).toBe('Alice: title');
    expect(result.path).toContain(dir);
    expect(result.path).toContain('-alice-alice-title-111.pdf');
    expect(readdirSync(dir)).toContain(result.path.split('/').pop());
    expect(win.destroy).toHaveBeenCalledTimes(1);
  });

  it('hands the effective selectors to the injected script, so an override reaches the exporter', async () => {
    const win = fakeWindow();
    await exportPdf({ url: POST, outDir: outDir(), selectors: { article: 'section[data-post]' } as never }, { createWindow: () => win });
    const code = (win.executeJavaScript as unknown as { mock: { calls: string[][] } }).mock.calls[0][0];
    expect(code).toContain('"article":"section[data-post]"');
  });

  it('rejects quickly when loadURL never resolves, still destroys the window', async () => {
    const win = fakeWindow({ loadURL: vi.fn(() => new Promise<void>(() => {})) });
    const dir = outDir();
    const start = Date.now();
    await expect(exportPdf({ url: POST, outDir: dir, timeoutMs: 50 }, { createWindow: () => win })).rejects.toThrow('timed out');
    expect(Date.now() - start).toBeLessThan(150);
    expect(win.destroy).toHaveBeenCalledTimes(1);
  });

  it('aborts when the window navigated away while the page was being prepared', async () => {
    let url = POST;
    const win = fakeWindow({
      executeJavaScript: vi.fn(async () => {
        url = 'https://x.com/messages';
        return { title: 'Direct messages with Alice', author: 'attacker', id: '111' };
      }),
      getURL: () => url,
    });
    const dir = outDir();
    await expect(exportPdf({ url: POST, outDir: dir }, { createWindow: () => win })).rejects.toThrow('moved during the export');
    expect(win.printToPDF).not.toHaveBeenCalled();
    expect(readdirSync(dir)).toEqual([]);
    expect(win.destroy).toHaveBeenCalledTimes(1);
  });

  it('aborts when the page reports metadata for another post', async () => {
    const win = fakeWindow({
      executeJavaScript: vi.fn(async () => ({ title: 'Direct messages with Alice', author: 'attacker', id: '999' })),
    });
    const dir = outDir();
    await expect(exportPdf({ url: POST, outDir: dir }, { createWindow: () => win })).rejects.toThrow('different post');
    expect(readdirSync(dir)).toEqual([]);
  });

  it('names the file from the requested post, not from page-chosen author, id or whitespace-padded title', async () => {
    const win = fakeWindow({
      executeJavaScript: vi.fn(async () => ({
        title: `  Alice:\n\n title  ${'x'.repeat(400)}`,
        author: '../../../etc/passwd',
        id: '../../../etc/passwd',
      })),
    });
    const dir = outDir();
    await expect(exportPdf({ url: POST, outDir: dir }, { createWindow: () => win })).rejects.toThrow('different post');

    const clean = fakeWindow({
      executeJavaScript: vi.fn(async () => ({ title: '  Alice:\n\n title  ', author: '../../../etc/passwd', id: '111' })),
    });
    const result = await exportPdf({ url: POST, outDir: dir }, { createWindow: () => clean });
    expect(result.title).toBe('Alice: title');
    expect(result.path.startsWith(dir + '/')).toBe(true);
    expect(result.path).not.toContain('..');
    expect(result.path).toContain('-alice-alice-title-111.pdf');
    expect(readdirSync(dir)).toEqual([result.path.split('/').pop()]);
  });

  it('exports an X Article by its /i/article/ URL', async () => {
    const url = 'https://x.com/i/article/555';
    const win = fakeWindow({
      executeJavaScript: vi.fn(async () => ({ title: 'On Compilers', author: 'alice', id: '555' })),
      getURL: () => url,
    });
    const dir = outDir();
    const result = await exportPdf({ url, outDir: dir }, { createWindow: () => win });
    expect(result.path).toContain('-alice-on-compilers-555.pdf');
  });

  it('refuses a URL that is not a post URL at all', async () => {
    const dir = outDir();
    await expect(
      exportPdf({ url: 'https://evil.com/alice/status/111', outDir: dir }, { createWindow: () => fakeWindow() }),
    ).rejects.toThrow('Not a post or article URL');
    expect(readdirSync(dir)).toEqual([]);
  });

  it('tolerates an ERR_ABORTED rejection from loadURL', async () => {
    const win = fakeWindow({
      loadURL: vi.fn(async () => {
        throw new Error('ERR_ABORTED (-3)');
      }),
    });
    const dir = outDir();
    const result = await exportPdf({ url: POST, outDir: dir }, { createWindow: () => win });
    expect(result.title).toBe('Alice: title');
    expect(win.destroy).toHaveBeenCalledTimes(1);
  });

  it('still exports when the window cannot report its URL, checking the metadata id alone', async () => {
    const win = fakeWindow({ getURL: undefined });
    const dir = outDir();
    const result = await exportPdf({ url: POST, outDir: dir }, { createWindow: () => win });
    expect(result.path).toContain('-111.pdf');
  });
});
