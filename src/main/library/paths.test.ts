import { describe, it, expect } from 'vitest';
import { isInsideDir } from './paths';

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
