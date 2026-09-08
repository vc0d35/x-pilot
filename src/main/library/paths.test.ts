import { describe, it, expect } from 'vitest';
import { isInsideDir, isOpenablePdf } from './paths';

describe('isInsideDir', () => {
  it('is true for a path inside the directory', () => {
    expect(isInsideDir('/lib/a.pdf', '/lib')).toBe(true);
  });
  it('is true for the directory itself', () => {
    expect(isInsideDir('/lib', '/lib')).toBe(true);
  });
  it('is false for a sibling directory whose name merely shares a prefix', () => {
    expect(isInsideDir('/lib-exfil/a.pdf', '/lib')).toBe(false);
  });
  it('is false for a path that escapes the directory via ..', () => {
    expect(isInsideDir('/lib/../etc/passwd', '/lib')).toBe(false);
  });
});

describe('isOpenablePdf', () => {
  const none = () => false;
  it('accepts a PDF inside the library folder', () => {
    expect(isOpenablePdf('/lib/a.pdf', '/lib', none)).toBe(true);
    expect(isOpenablePdf('/lib/sub/a.PDF', '/lib', none)).toBe(true);
  });
  it('refuses a non-PDF inside the library folder', () => {
    expect(isOpenablePdf('/lib/notes.txt', '/lib', none)).toBe(false);
    expect(isOpenablePdf('/lib/run.sh', '/lib', none)).toBe(false);
    expect(isOpenablePdf('/lib/app.pdf.command', '/lib', none)).toBe(false);
    expect(isOpenablePdf('/lib/pdf', '/lib', none)).toBe(false);
  });
  it('refuses a PDF outside the library folder unless the library recorded it', () => {
    expect(isOpenablePdf('/elsewhere/a.pdf', '/lib', none)).toBe(false);
    expect(isOpenablePdf('/elsewhere/a.pdf', '/lib', (p) => p === '/elsewhere/a.pdf')).toBe(true);
  });
  it('refuses a recorded path that is not a PDF', () => {
    expect(isOpenablePdf('/elsewhere/a.sh', '/lib', () => true)).toBe(false);
  });
  it('checks the recorded path after resolving it', () => {
    expect(isOpenablePdf('/elsewhere/./a.pdf', '/lib', (p) => p === '/elsewhere/a.pdf')).toBe(true);
    expect(isOpenablePdf('/lib/../etc/a.pdf', '/lib', none)).toBe(false);
  });
});
