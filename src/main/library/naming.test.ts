import { describe, it, expect } from 'vitest';
import { pdfFileName, sanitizeId, slugify } from './naming';
describe('pdfFileName', () => {
  it('builds a safe, dated file name', () => {
    expect(slugify('Hello, World! Ünïcode & stuff')).toBe('hello-world-unicode-stuff');
    expect(pdfFileName({ date: new Date('2026-09-07T10:00:00Z'), author: 'alice', title: 'On Compilers: a long essay about many things that goes on', id: '111' }))
      .toBe('2026-09-07-alice-on-compilers-a-long-essay-about-many-things-111.pdf');
    expect(pdfFileName({ date: new Date('2026-09-07T10:00:00Z'), author: '', title: '', id: '5' })).toBe('2026-09-07-x-post-5.pdf');
  });

  it('strips path syntax out of the id, which comes from the page', () => {
    expect(sanitizeId('../../../etc/passwd')).toBe('etcpasswd');
    expect(sanitizeId('/absolute')).toBe('absolute');
    expect(sanitizeId('..')).toBe('x');
    expect(sanitizeId('')).toBe('x');
    expect(sanitizeId('a'.repeat(200))).toHaveLength(32);
  });

  it('cannot be talked into a traversing file name', () => {
    expect(pdfFileName({ date: new Date('2026-09-07T10:00:00Z'), author: 'alice', title: 'hi', id: '../../evil' }))
      .toBe('2026-09-07-alice-hi-evil.pdf');
    expect(pdfFileName({ date: new Date('2026-09-07T10:00:00Z'), author: 'alice', title: 'hi', id: '111/../../x' }))
      .not.toContain('/');
  });
});
