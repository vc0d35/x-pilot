import { describe, it, expect } from 'vitest';
import { mediaUrl } from './media-url';

describe('mediaUrl', () => {
  it.each([
    'https://pbs.twimg.com/media/HR7XqfOWAAcGIWv?format=jpg&name=small',
    'https://pbs.twimg.com/profile_images/719163421934137344/RsnjNy0I_normal.jpg',
    'https://video.twimg.com/amplify_video/1889404481/vid/avc1/1280x720/ZJ0mCxQ0.mp4',
    'https://abs.twimg.com/responsive-web/client-web/icon.png',
    'https://ton.twimg.com/card_img/1889404481/ZJ0mCxQ0',
  ])('keeps %s', (url) => expect(mediaUrl(url)).toBe(url));

  it.each([
    ['nothing at all', ''],
    ['a data: URL', 'data:image/png;base64,iVBORw0KGgo='],
    ['a blob: URL, which is what X plays a video from', 'blob:https://x.com/8b3c-4f2a'],
    ['plain http on the right host', 'http://pbs.twimg.com/media/HR7XqfOWAAcGIWv.jpg'],
    ['an attacker host', 'https://evil.test/media/HR7XqfOWAAcGIWv.jpg'],
    ['a host that only ends in the right name', 'https://twimg.com.evil.test/media/HR7XqfOWAAcGIWv.jpg'],
    ['the right host in the path', 'https://evil.test/pbs.twimg.com/media/HR7XqfOWAAcGIWv.jpg'],
    ['the right host in a userinfo field', 'https://pbs.twimg.com@evil.test/media/HR7XqfOWAAcGIWv.jpg'],
    ['the bare domain', 'https://twimg.com/media/HR7XqfOWAAcGIWv.jpg'],
    ['a relative path, which is what a stripped fixture has', '/media/HR7XqfOWAAcGIWv.jpg'],
    ['javascript:', 'javascript:alert(1)'],
  ])('drops %s', (_what, url) => expect(mediaUrl(url)).toBeUndefined());

  it('drops a URL over 512 characters rather than truncating it into a different one', () => {
    const long = `https://pbs.twimg.com/media/${'a'.repeat(512)}.jpg`;
    expect(mediaUrl(long)).toBeUndefined();
    expect(mediaUrl(`https://pbs.twimg.com/media/${'a'.repeat(512 - 32)}.jpg`)).toHaveLength(512);
  });

  it('takes a missing attribute as no URL', () => {
    expect(mediaUrl(null)).toBeUndefined();
    expect(mediaUrl(undefined)).toBeUndefined();
  });
});
