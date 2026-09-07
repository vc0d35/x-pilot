import { fail, ok, type ToolModule } from '../../../../shared/tools';
import type { PreloadCtx } from '../../context';
import { sleep, waitFor } from '../dom';
import { extractComposer } from '../extract';
import { SEL } from '../selectors';

async function waitComposer(timeoutMs: number) {
  try { await waitFor(() => document.querySelector(SEL.composerTextarea), timeoutMs); return true; } catch { return false; }
}

export const readComposer: ToolModule<PreloadCtx> = {
  spec: { name: 'x_read_composer', description: 'Reads the open post composer: whether it is open, its current text, and whether Post is enabled.', inputSchema: { type: 'object', properties: { timeoutMs: { type: 'integer', default: 5000 } }, additionalProperties: false }, annotations: { readOnlyHint: true } },
  execute: async (args) => {
    if (!(await waitComposer(typeof args.timeoutMs === 'number' ? args.timeoutMs : 5000))) return fail('No composer is open');
    return ok(extractComposer(document));
  },
};

export const typeInComposer: ToolModule<PreloadCtx> = {
  spec: { name: 'x_type_in_composer', description: 'Types text into the open composer (used when the compose URL did not prefill it).', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } },
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
  spec: { name: 'x_click_post_button', description: 'Clicks the Post button of the open composer and reports the confirmation toast and new post URL if shown. Internal: main calls this after approval.', inputSchema: { type: 'object', properties: { timeoutMs: { type: 'integer', default: 8000 } }, additionalProperties: false }, annotations: { destructiveHint: true } },
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
