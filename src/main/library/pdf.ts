import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import prepareSource from './prepare-page.js?raw';
import { pdfFileName } from './naming';

export interface PdfWindow {
  loadURL(url: string): Promise<void>;
  executeJavaScript(code: string): Promise<unknown>;
  printToPDF(options: object): Promise<Buffer>;
  destroy(): void;
}
export interface PdfDeps { createWindow(): PdfWindow }

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((_, rej) => { timer = setTimeout(() => rej(new Error(`${what} timed out after ${ms} ms`)), ms); });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

export async function exportPdf(opts: { url: string; outDir: string; timeoutMs?: number }, deps: PdfDeps): Promise<{ path: string; title: string }> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const deadline = Date.now() + timeoutMs;
  const remaining = () => Math.max(1, deadline - Date.now());
  const win = deps.createWindow();
  try {
    await withTimeout(win.loadURL(opts.url).catch((e: Error) => { if (!/ERR_ABORTED/.test(e.message)) throw e; }), remaining(), 'Page load');
    const innerTimeoutMs = Math.max(1000, remaining() - 2000);
    const meta = (await withTimeout(win.executeJavaScript(`(${prepareSource})({ timeoutMs: ${innerTimeoutMs} })`), remaining(), 'Page preparation')) as { title: string; author: string; id: string };
    const data = await withTimeout(win.printToPDF({ printBackground: true, pageSize: 'A4', margins: { marginType: 'default' } }), remaining(), 'printToPDF');
    mkdirSync(opts.outDir, { recursive: true });
    const path = join(opts.outDir, pdfFileName({ date: new Date(), author: meta.author, title: meta.title, id: meta.id || String(Date.now()) }));
    writeFileSync(path, data);
    return { path, title: meta.title };
  } finally {
    win.destroy();
  }
}
