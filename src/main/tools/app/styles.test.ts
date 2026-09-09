import { describe, it, expect, vi } from 'vitest';
import { readPageStyles, writePageStyles, resetPageStyles } from './styles';
import type { AppToolCtx } from './context';
import type { StylesWriteResult } from '../../page-config/styles';

function ctx(opts: { css?: string; write?: StylesWriteResult } = {}) {
  const set = vi.fn((): StylesWriteResult => opts.write ?? { ok: true, bytes: 3 });
  const reset = vi.fn();
  return {
    set,
    reset,
    value: {
      styles: { path: '/profile/page-styles.css', get: () => opts.css ?? 'a { color: red }', set, reset },
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
});

describe('xpilot_reset_page_styles', () => {
  it('empties the stylesheet', async () => {
    const c = ctx();
    expect(await resetPageStyles.execute({}, c.value)).toEqual({ success: true, content: { ok: true, path: '/profile/page-styles.css' } });
    expect(c.reset).toHaveBeenCalled();
  });
});
