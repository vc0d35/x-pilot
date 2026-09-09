import { describe, it, expect, vi } from 'vitest';
import { readPageStyles, writePageStyles, resetPageStyles } from './styles';
import { ApprovalBroker } from '../../approvals';
import type { AppToolCtx } from './context';
import type { StylesWriteResult } from '../../page-config/styles';
import type { ApprovalRequest } from '../../../shared/agent';

function ctx(
  opts: { css?: string; write?: StylesWriteResult; mode?: 'confirm' | 'autonomous'; decision?: string; lastError?: string } = {},
) {
  const set = vi.fn((): StylesWriteResult => opts.write ?? { ok: true, bytes: 3 });
  const reset = vi.fn();
  const approvals = new ApprovalBroker();
  const asked: ApprovalRequest[] = [];
  approvals.onEvent((e) => {
    if (e.type !== 'approval.requested') return;
    asked.push(e.request);
    if (opts.decision !== 'timeout') approvals.resolve(e.request.id, opts.decision ?? 'apply');
  });
  return {
    set,
    reset,
    asked,
    approvals,
    value: {
      styles: {
        path: '/profile/page-styles.css',
        get: () => opts.css ?? 'a { color: red }',
        set,
        reset,
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
      content: { ok: true, bytes: 16 },
    });
    expect(c.set).toHaveBeenCalledWith('a { color: red }');
  });

  it('reports a refusal with its reason', async () => {
    const c = ctx({ write: { ok: false, reason: '@import is not allowed' } });
    expect(await writePageStyles.execute({ css: '@import "x";' }, c.value)).toEqual({
      success: false,
      error: 'Rejected: @import is not allowed',
    });
  });

  it('shows the user the whole stylesheet and applies it once they say so', async () => {
    const c = ctx({ mode: 'confirm', write: { ok: true, bytes: 5 } });
    const css = '#danger { position: fixed; inset: 0; opacity: 0 }';
    expect(await writePageStyles.execute({ css }, c.value)).toMatchObject({ success: true });
    expect(c.asked).toHaveLength(1);
    expect(c.asked[0]).toMatchObject({
      title: 'Apply these page styles?',
      detail: css,
      options: [
        { id: 'apply', label: 'Apply' },
        { id: 'cancel', label: 'Cancel' },
      ],
    });
    expect(c.set).toHaveBeenCalledWith(css);
  });

  it('writes nothing when the user declines, and says the decision was theirs', async () => {
    const c = ctx({ mode: 'confirm', decision: 'cancel' });
    expect(await writePageStyles.execute({ css: 'a {}' }, c.value)).toEqual({
      success: true,
      content: { applied: false, status: 'cancelled_by_user', reason: expect.stringContaining('chose not to apply') },
    });
    expect(c.set).not.toHaveBeenCalled();
  });

  it('does not ask in autonomous mode', async () => {
    const c = ctx({ mode: 'autonomous' });
    await writePageStyles.execute({ css: 'a {}' }, c.value);
    expect(c.asked).toHaveLength(0);
    expect(c.set).toHaveBeenCalled();
  });
});

describe('xpilot_reset_page_styles', () => {
  it('empties the stylesheet', async () => {
    const c = ctx();
    expect(await resetPageStyles.execute({}, c.value)).toEqual({ success: true, content: { ok: true, path: '/profile/page-styles.css' } });
    expect(c.reset).toHaveBeenCalled();
  });

  it('asks first in confirm mode and leaves the file alone on a decline', async () => {
    const c = ctx({ mode: 'confirm', decision: 'cancel' });
    expect(await resetPageStyles.execute({}, c.value)).toMatchObject({ content: { status: 'cancelled_by_user' } });
    expect(c.asked[0]).toMatchObject({ title: 'Remove every page style?', detail: 'a { color: red }' });
    expect(c.reset).not.toHaveBeenCalled();
  });
});
