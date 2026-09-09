import { describe, it, expect } from 'vitest';
import { claimedHost, collapseBlankLines, deceptiveLinkHost } from './display-safety';

describe('collapseBlankLines', () => {
  it('keeps single blank lines and collapses runs of them', () => {
    expect(collapseBlankLines('a\n\nb')).toBe('a\n\nb');
    expect(collapseBlankLines('a\n\n\n\n\nb')).toBe('a\n\nb');
    expect(collapseBlankLines(`rm -rf ~${'\n'.repeat(300)}(cwd: /w)`)).toBe('rm -rf ~\n\n(cwd: /w)');
    expect(collapseBlankLines('a\r\n\r\n\r\n\r\nb')).toBe('a\n\nb');
  });

  it('bounds the line count of a padded detail', () => {
    const padded = `rm -rf ~${'\n'.repeat(200)}(cwd: /w)`;
    expect(padded.split('\n')).toHaveLength(201);
    expect(collapseBlankLines(padded).split('\n')).toHaveLength(3);
  });
});

describe('claimedHost', () => {
  it.each([
    ['https://x.com/safe', 'x.com'],
    ['x.com/safe', 'x.com'],
    ['www.evil.com', 'evil.com'],
    ['X.COM', 'x.com'],
    ['sub.x.com:443/path', 'sub.x.com'],
  ])('%s claims %s', (text, host) => expect(claimedHost(text)).toBe(host));

  it.each(['Your bookmarks', 'read this', '', 'x.c', 'not a host at all'])('%s claims nothing', (text) => {
    expect(claimedHost(text)).toBeNull();
  });
});

describe('deceptiveLinkHost', () => {
  it('reports the real host when the text claims another one', () => {
    expect(deceptiveLinkHost('https://x.com/safe', 'https://evil.com/phish')).toBe('evil.com');
    expect(deceptiveLinkHost('x.com/safe', 'https://evil.com/phish')).toBe('evil.com');
    expect(deceptiveLinkHost('x.com', 'https://sub.x.com/i/flow/login')).toBe('sub.x.com');
  });

  it('stays quiet for honest links and for text that is not a destination', () => {
    expect(deceptiveLinkHost('https://x.com/safe', 'https://x.com/safe')).toBeNull();
    expect(deceptiveLinkHost('www.evil.com', 'http://evil.com')).toBeNull();
    expect(deceptiveLinkHost('Your bookmarks', 'https://x.com/i/flow/login')).toBeNull();
    expect(deceptiveLinkHost('x.com/safe', 'not-a-url')).toBeNull();
  });
});
