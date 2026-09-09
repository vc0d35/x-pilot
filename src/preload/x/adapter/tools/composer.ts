import { fail, ok, type ToolModule } from '../../../../shared/tools';
import type { PreloadCtx } from '../../context';
import { sleep, waitFor } from '../dom';
import { extractComposer } from '../extract';
import { SEL } from '../selectors';
import { clickPostButtonSpec, readComposerSpec, typeInComposerSpec } from './specs';

async function waitComposer(timeoutMs: number) {
  try { await waitFor(() => document.querySelector(SEL.composerTextarea), timeoutMs); return true; } catch { return false; }
}

export const readComposer: ToolModule<PreloadCtx> = {
  spec: readComposerSpec,
  execute: async (args) => {
    if (!(await waitComposer(typeof args.timeoutMs === 'number' ? args.timeoutMs : 5000))) return fail('No composer is open');
    return ok(extractComposer(document));
  },
};

export const typeInComposer: ToolModule<PreloadCtx> = {
  spec: typeInComposerSpec,
  execute: async (args) => {
    if (!(await waitComposer(5000))) return fail('No composer is open');
    const ta = document.querySelector<HTMLElement>(SEL.composerTextarea)!;
    ta.focus();
    document.execCommand('selectAll', false);
    document.execCommand('insertText', false, String(args.text ?? ''));
    await sleep(200);
    return ok(extractComposer(document));
  },
};

export const clickPostButton: ToolModule<PreloadCtx> = {
  spec: clickPostButtonSpec,
  execute: async (args) => {
    const state = extractComposer(document);
    if (!state.present) return fail('No composer is open');
    if (!state.canSubmit) return fail('Post button is disabled (empty draft or over the length limit)');
    document.querySelector<HTMLElement>(SEL.postButton)!.click();
    const timeoutMs = typeof args.timeoutMs === 'number' ? args.timeoutMs : 8000;
    try { await waitFor(() => document.querySelector(SEL.toast) || !document.querySelector(SEL.composerTextarea), timeoutMs); } catch { /* report what we have */ }
    const toast = document.querySelector(SEL.toast);
    const href = toast?.querySelector('a[href*="/status/"]')?.getAttribute('href') ?? null;
    return ok({ clicked: true, toast: toast?.textContent?.trim() ?? null, url: href ? `https://x.com${href}` : null });
  },
};
