import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import prepareSource from './prepare-page.js?raw';
import { normalizePostUrl } from '../tools/xview/read-post';
import { pdfFileName } from './naming';
import { isInsideDir } from './paths';

export interface PdfWindow {
  loadURL(url: string): Promise<void>;
  executeJavaScript(code: string): Promise<unknown>;
  printToPDF(options: object): Promise<Buffer>;
  /** Optional so the interface stays satisfiable by simpler fakes; supply it to get the mid-export navigation check. */
  getURL?(): string;
  destroy(): void;
}
export interface PdfDeps {
  createWindow(): PdfWindow;
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`${what} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

export async function exportPdf(
  opts: { url: string; outDir: string; timeoutMs?: number },
  deps: PdfDeps,
): Promise<{ path: string; title: string }> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const deadline = Date.now() + timeoutMs;
  const remaining = () => Math.max(1, deadline - Date.now());
  const win = deps.createWindow();
  try {
    await withTimeout(
      win.loadURL(opts.url).catch((e: Error) => {
        if (!/ERR_ABORTED/.test(e.message)) throw e;
      }),
      remaining(),
      'Page load',
    );
    const innerTimeoutMs = Math.max(1000, remaining() - 2000);
    const meta = (await withTimeout(
      win.executeJavaScript(`(${prepareSource})({ timeoutMs: ${innerTimeoutMs} })`),
      remaining(),
      'Page preparation',
    )) as { title: string; author: string; id: string };
    // The page may navigate under the exporter (pushState included) and it writes its own metadata,
    // so what was printed is only what was asked for if both still agree with the requested URL.
    const requested = normalizePostUrl(opts.url);
    if (!requested) throw new Error(`Not a post or article URL: ${opts.url}`);
    const landed = win.getURL ? normalizePostUrl(win.getURL()) : requested;
    if (landed !== requested)
      throw new Error(`The page moved during the export: expected ${requested}, got ${win.getURL?.() ?? 'an unknown URL'}`);
    const requestedId = /\/(\d{1,25})$/.exec(requested)?.[1] ?? '';
    if (String(meta.id ?? '') !== requestedId)
      throw new Error(`The page reported a different post (${meta.id}) than the one exported (${requestedId})`);
    const urlAuthor = /^https:\/\/x\.com\/([A-Za-z0-9_]{1,15})\//.exec(requested)?.[1] ?? '';
    const author = urlAuthor === 'i' ? String(meta.author ?? '') : urlAuthor;
    const title = String(meta.title ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
    const data = await withTimeout(
      win.printToPDF({ printBackground: true, pageSize: 'A4', margins: { marginType: 'default' } }),
      remaining(),
      'printToPDF',
    );
    mkdirSync(opts.outDir, { recursive: true });
    const path = join(opts.outDir, pdfFileName({ date: new Date(), author, title, id: requestedId }));
    if (!isInsideDir(path, opts.outDir)) throw new Error(`Refusing to write outside the library folder: ${path}`);
    writeFileSync(path, data);
    return { path, title };
  } finally {
    win.destroy();
  }
}
