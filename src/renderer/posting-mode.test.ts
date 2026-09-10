import { describe, it, expect } from 'vitest';
import {
  AUTONOMOUS_STYLES_WARNING,
  AUTONOMOUS_VIEWS_WARNING,
  AUTONOMOUS_WARNING,
  confirmPostingMode,
  confirmStylesMode,
  confirmViewsMode,
} from './posting-mode';

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

describe('confirmStylesMode', () => {
  it('warns before letting the agent restyle the page unasked, and honours the answer', () => {
    const seen: string[] = [];
    expect(
      confirmStylesMode('autonomous', (m) => {
        seen.push(m);
        return true;
      }),
    ).toBe('autonomous');
    expect(
      confirmStylesMode('autonomous', (m) => {
        seen.push(m);
        return false;
      }),
    ).toBeNull();
    expect(seen).toEqual([AUTONOMOUS_STYLES_WARNING, AUTONOMOUS_STYLES_WARNING]);
  });

  it('never warns when switching back to confirm', () => {
    expect(
      confirmStylesMode('confirm', () => {
        throw new Error('should not be asked');
      }),
    ).toBe('confirm');
  });
});

describe('confirmViewsMode', () => {
  it('warns before letting the agent replace the page unasked, and honours the answer', () => {
    const seen: string[] = [];
    expect(
      confirmViewsMode('autonomous', (m) => {
        seen.push(m);
        return true;
      }),
    ).toBe('autonomous');
    expect(
      confirmViewsMode('autonomous', (m) => {
        seen.push(m);
        return false;
      }),
    ).toBeNull();
    expect(seen).toEqual([AUTONOMOUS_VIEWS_WARNING, AUTONOMOUS_VIEWS_WARNING]);
  });

  it('never warns when switching back to confirm', () => {
    expect(
      confirmViewsMode('confirm', () => {
        throw new Error('should not be asked');
      }),
    ).toBe('confirm');
  });
});
