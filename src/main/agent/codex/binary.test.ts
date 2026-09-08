import { describe, it, expect } from 'vitest';
import { augmentedPath } from './binary';

describe('augmentedPath', () => {
  it('puts the binary directory first, then the login shell PATH, then the current PATH, without duplicates', () => {
    expect(augmentedPath('/Users/me/.nvm/versions/node/v24/bin/codex', '/usr/bin:/bin', '/opt/homebrew/bin:/usr/bin'))
      .toBe('/Users/me/.nvm/versions/node/v24/bin:/opt/homebrew/bin:/usr/bin:/bin');
  });
  it('copes with a missing login shell PATH and an empty current PATH', () => {
    expect(augmentedPath('/usr/local/bin/codex', undefined, null)).toBe('/usr/local/bin');
  });
});
