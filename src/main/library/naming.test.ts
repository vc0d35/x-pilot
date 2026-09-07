import { describe, it, expect } from 'vitest';
import { pdfFileName, slugify } from './naming';
describe('pdfFileName', () => {
  it('builds a safe, dated file name', () => {
    expect(slugify('Hello, World! Ünïcode & stuff')).toBe('hello-world-unicode-stuff');
    expect(pdfFileName({ date: new Date('2026-09-07T10:00:00Z'), author: 'alice', title: 'On Compilers: a long essay about many things that goes on', id: '111' }))
      .toBe('2026-09-07-alice-on-compilers-a-long-essay-about-many-things-111.pdf');
    expect(pdfFileName({ date: new Date('2026-09-07T10:00:00Z'), author: '', title: '', id: '5' })).toBe('2026-09-07-x-post-5.pdf');
  });
});
