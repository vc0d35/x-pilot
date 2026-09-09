import { describe, it, expect } from 'vitest';
import { AUTONOMOUS_WARNING, confirmPostingMode } from './posting-mode';

describe('confirmPostingMode', () => {
  it('warns once before switching to autonomous and honours the answer', () => {
    const seen: string[] = [];
    const yes = (m: string) => {
      seen.push(m);
      return true;
    };
    const no = (m: string) => {
      seen.push(m);
      return false;
    };
    expect(confirmPostingMode('autonomous', yes)).toBe('autonomous');
    expect(confirmPostingMode('autonomous', no)).toBeNull();
    expect(seen).toEqual([AUTONOMOUS_WARNING, AUTONOMOUS_WARNING]);
  });

  it('never warns when switching back to confirm', () => {
    const confirmFn = () => {
      throw new Error('should not be asked');
    };
    expect(confirmPostingMode('confirm', confirmFn)).toBe('confirm');
  });
});
