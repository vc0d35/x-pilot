import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportPdf, type PdfWindow } from './pdf';

const outDir = () => mkdtempSync(join(tmpdir(), 'xpilot-pdf-'));

function fakeWindow(overrides: Partial<PdfWindow> = {}): PdfWindow {
  return {
    loadURL: vi.fn(async () => {}),
    executeJavaScript: vi.fn(async () => ({ title: 'Alice: title', author: 'alice', id: '111' })),
    printToPDF: vi.fn(async () => Buffer.from('%PDF-1.4 fake')),
    destroy: vi.fn(),
    ...overrides,
  };
}

describe('exportPdf', () => {
  it('writes a named PDF and returns the path and title', async () => {
    const win = fakeWindow();
    const dir = outDir();
    const result = await exportPdf({ url: 'https://x.com/alice/status/111', outDir: dir }, { createWindow: () => win });
    expect(result.title).toBe('Alice: title');
    expect(result.path).toContain(dir);
    expect(readdirSync(dir)).toContain(result.path.split('/').pop());
    expect(win.destroy).toHaveBeenCalledTimes(1);
  });

  it('rejects quickly when loadURL never resolves, still destroys the window', async () => {
    const win = fakeWindow({ loadURL: vi.fn(() => new Promise<void>(() => {})) });
    const dir = outDir();
    const start = Date.now();
    await expect(exportPdf({ url: 'https://x.com/alice/status/111', outDir: dir, timeoutMs: 50 }, { createWindow: () => win }))
      .rejects.toThrow('timed out');
    expect(Date.now() - start).toBeLessThan(150);
    expect(win.destroy).toHaveBeenCalledTimes(1);
  });

  it('tolerates an ERR_ABORTED rejection from loadURL', async () => {
    const win = fakeWindow({ loadURL: vi.fn(async () => { throw new Error('ERR_ABORTED (-3)'); }) });
    const dir = outDir();
    const result = await exportPdf({ url: 'https://x.com/alice/status/111', outDir: dir }, { createWindow: () => win });
    expect(result.title).toBe('Alice: title');
    expect(win.destroy).toHaveBeenCalledTimes(1);
  });
});
