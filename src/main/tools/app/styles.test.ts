import { describe, it, expect, vi } from 'vitest';
import { readPageStyles, writePageStyles, resetPageStyles } from './styles';
import { ApprovalBroker } from '../../approvals';
import type { AppToolCtx } from './context';
import type { StylesWriteResult } from '../../page-config/styles';
import type { ApprovalRequest } from '../../../shared/agent';

function ctx(
  opts: {
    css?: string;
    write?: StylesWriteResult;
    mode?: 'confirm' | 'autonomous';
    decision?: string;
    note?: string;
    lastError?: string;
    /** Throws out of `set`, standing in for anything that can fail after the user said Keep. */
    throwOnSet?: boolean;
  } = {},
) {
  const set = vi.fn((): StylesWriteResult => {
    if (opts.throwOnSet) throw new Error('the profile is read-only');
    return opts.write ?? { ok: true, bytes: 3 };
  });
  const reset = vi.fn();
  /** Every preview push in order, so a test can see the sheet go on and come back off. */
  const previews: (string | null)[] = [];
  const approvals = new ApprovalBroker();
  const asked: ApprovalRequest[] = [];
  approvals.onEvent((e) => {
    if (e.type !== 'approval.requested') return;
    asked.push(e.request);
    if (opts.decision !== 'timeout') approvals.resolve(e.request.id, opts.decision ?? 'keep', opts.note);
  });
  return {
    set,
    reset,
    asked,
    previews,
    approvals,
    value: {
      styles: {
        path: '/profile/page-styles.css',
        get: () => opts.css ?? 'a { color: red }',
        set,
        reset,
        preview: (css: string | null) => previews.push(css),
        lastError: opts.lastError ?? null,
      },
      approvals,
      stylesMode: () => opts.mode ?? 'autonomous',
    } as unknown as AppToolCtx,
  };
}

describe('xpilot_read_page_styles', () => {
  it('returns the stylesheet and where it lives', async () => {
    expect(await readPageStyles.execute({}, ctx().value)).toEqual({
      success: true,
      content: { path: '/profile/page-styles.css', css: 'a { color: red }' },
    });
  });

  it('says when what is on disk is not what is applied', async () => {
    expect(await readPageStyles.execute({}, ctx({ lastError: 'a backslash escape is not allowed' }).value)).toMatchObject({
      content: { notApplied: 'a backslash escape is not allowed' },
    });
  });
});

describe('xpilot_write_page_styles', () => {
  it('replaces the file and reports the size written', async () => {
    const c = ctx({ write: { ok: true, bytes: 16 } });
    expect(await writePageStyles.execute({ css: 'a { color: red }' }, c.value)).toEqual({
      success: true,
      content: { status: 'kept', bytes: 16 },
    });
    expect(c.set).toHaveBeenCalledWith('a { color: red }');
  });

  it('refuses a stylesheet before it ever reaches the page', async () => {
    const c = ctx({ mode: 'confirm' });
    expect(await writePageStyles.execute({ css: '@import "x";' }, c.value)).toEqual({
      success: false,
      error: 'Rejected: @import is not allowed',
    });
    expect(c.previews).toEqual([]);
    expect(c.asked).toHaveLength(0);
  });

  it('previews the sheet on the page, asks, and writes it when the user keeps it', async () => {
    const c = ctx({ mode: 'confirm', write: { ok: true, bytes: 5 } });
    const css = '#danger { position: fixed; inset: 0; opacity: 0 }';
    expect(await writePageStyles.execute({ css }, c.value)).toEqual({ success: true, content: { status: 'kept', bytes: 5 } });
    expect(c.asked).toHaveLength(1);
    expect(c.asked[0]).toMatchObject({
      title: 'Keep these page styles?',
      detail: css,
      options: [
        { id: 'keep', label: 'Keep' },
        { id: 'adjust', label: 'Adjust…', note: true },
        { id: 'revert', label: 'Revert' },
      ],
    });
    // The preview comes off before the file is written; the watcher's push is what makes it current.
    expect(c.previews).toEqual([css, null]);
    expect(c.set).toHaveBeenCalledWith(css);
  });

  it('returns the note when the user asks for an adjustment, and writes nothing', async () => {
    const c = ctx({ mode: 'confirm', decision: 'adjust', note: 'too much padding on the sidebar' });
    expect(await writePageStyles.execute({ css: 'a {}' }, c.value)).toEqual({
      success: true,
      content: {
        status: 'adjust_requested',
        note: 'too much padding on the sidebar',
        reason: expect.stringContaining('apply the note and propose again'),
      },
    });
    expect(c.previews).toEqual(['a {}', null]);
    expect(c.set).not.toHaveBeenCalled();
  });

  it('takes the preview off and says the decision was theirs when the user reverts', async () => {
    const c = ctx({ mode: 'confirm', decision: 'revert' });
    expect(await writePageStyles.execute({ css: 'a {}' }, c.value)).toEqual({
      success: true,
      content: { status: 'cancelled_by_user', reason: expect.stringContaining('chose to revert') },
    });
    expect(c.previews).toEqual(['a {}', null]);
    expect(c.set).not.toHaveBeenCalled();
  });

  it('takes the preview off when nobody answers in time', async () => {
    vi.useFakeTimers();
    const c = ctx({ mode: 'confirm', decision: 'timeout' });
    const pending = writePageStyles.execute({ css: 'a {}' }, c.value);
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 10);
    expect(await pending).toEqual({
      success: true,
      content: { status: 'confirmation_timed_out', reason: expect.stringContaining('within 5 minutes') },
    });
    expect(c.previews).toEqual(['a {}', null]);
    expect(c.set).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('takes the preview off when the write itself throws', async () => {
    const c = ctx({ mode: 'confirm', throwOnSet: true });
    await expect(writePageStyles.execute({ css: 'a {}' }, c.value)).rejects.toThrow('the profile is read-only');
    expect(c.previews).toEqual(['a {}', null]);
  });

  it('does not ask, and previews nothing, in autonomous mode', async () => {
    const c = ctx({ mode: 'autonomous' });
    await writePageStyles.execute({ css: 'a {}' }, c.value);
    expect(c.asked).toHaveLength(0);
    expect(c.previews).toEqual([]);
    expect(c.set).toHaveBeenCalled();
  });
});

describe('xpilot_reset_page_styles', () => {
  it('empties the stylesheet', async () => {
    const c = ctx();
    expect(await resetPageStyles.execute({}, c.value)).toEqual({
      success: true,
      content: { status: 'kept', path: '/profile/page-styles.css' },
    });
    expect(c.reset).toHaveBeenCalled();
  });

  it('asks first in confirm mode, with no Adjust and nothing previewed', async () => {
    const c = ctx({ mode: 'confirm', decision: 'revert' });
    expect(await resetPageStyles.execute({}, c.value)).toMatchObject({ content: { status: 'cancelled_by_user' } });
    expect(c.asked[0]).toMatchObject({
      title: 'Remove every page style?',
      detail: 'a { color: red }',
      options: [
        { id: 'keep', label: 'Keep' },
        { id: 'revert', label: 'Revert' },
      ],
    });
    // Taking rules away is not something a layered sheet can show, so the page is left alone.
    expect(c.previews).toEqual([null, null]);
    expect(c.reset).not.toHaveBeenCalled();
  });
});
