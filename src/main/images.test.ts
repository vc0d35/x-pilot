import { describe, it, expect, vi } from 'vitest';
import { fetchImage, imageRequestUrl } from './images';

const PHOTO = 'https://pbs.twimg.com/media/HR7XqfOWAAcGIWv?format=jpg&name=small';

describe('imageRequestUrl', () => {
  it('picks the rendition itself on the paths that take one, keeping the format', () => {
    expect(imageRequestUrl(PHOTO)).toBe('https://pbs.twimg.com/media/HR7XqfOWAAcGIWv?format=jpg&name=medium');
    expect(imageRequestUrl(PHOTO, 'high')).toBe('https://pbs.twimg.com/media/HR7XqfOWAAcGIWv?format=jpg&name=large');
    expect(imageRequestUrl('https://pbs.twimg.com/card_img/1/abc?format=jpg&name=800x320_1', 'low')).toContain('name=small');
  });

  it('leaves a URL that names its own size alone', () => {
    const avatar = 'https://pbs.twimg.com/profile_images/1/abc_normal.jpg';
    expect(imageRequestUrl(avatar)).toBe(avatar);
  });

  it('refuses everything that is not https on the image CDN', () => {
    for (const url of [
      'http://pbs.twimg.com/media/a?format=jpg',
      'https://video.twimg.com/ext_tw_video/1/pu/vid/a.mp4',
      'https://pbs.twimg.com.evil.test/media/a',
      'https://evil.test/pbs.twimg.com/media/a',
      'https://user:pw@pbs.twimg.com/media/a',
      'https://pbs.twimg.com:8443/media/a',
      'https://127.0.0.1/media/a',
      'file:///etc/passwd',
      'data:image/png;base64,AAAA',
      'not a url',
    ])
      expect(imageRequestUrl(url), url).toBeNull();
  });
});

const response = (body: Uint8Array, headers: Record<string, string>, status = 200) =>
  new Response(status === 200 ? (body as BodyInit) : null, { status, headers });

describe('fetchImage', () => {
  it('fetches with no cookies and no redirects, and answers base64', async () => {
    const fetch = vi.fn(async () => response(new Uint8Array([1, 2, 3]), { 'content-type': 'image/jpeg; charset=binary' }));
    expect(await fetchImage(PHOTO, 'medium', { fetch })).toEqual({ mimeType: 'image/jpeg', data: 'AQID' });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('name=medium');
    expect(init).toMatchObject({ redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer' });
  });

  it('never fetches a URL the gate refuses', async () => {
    const fetch = vi.fn();
    await expect(fetchImage('https://evil.test/a.png', 'medium', { fetch })).rejects.toThrow('image CDN');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses what is not an image, what failed, and what is too large by header or by body', async () => {
    const as = (r: Response) => ({ fetch: vi.fn(async () => r) });
    await expect(fetchImage(PHOTO, 'medium', as(response(new Uint8Array([1]), { 'content-type': 'text/html' })))).rejects.toThrow(
      'Not an image',
    );
    await expect(fetchImage(PHOTO, 'medium', as(response(new Uint8Array(), {}, 404)))).rejects.toThrow('HTTP 404');
    await expect(
      fetchImage(
        PHOTO,
        'medium',
        as(response(new Uint8Array([1]), { 'content-type': 'image/png', 'content-length': String(6 * 1024 * 1024) })),
      ),
    ).rejects.toThrow('larger than 5 MB');
    await expect(
      fetchImage(PHOTO, 'medium', as(response(new Uint8Array(5 * 1024 * 1024 + 1), { 'content-type': 'image/png' }))),
    ).rejects.toThrow('larger than 5 MB');
    await expect(fetchImage(PHOTO, 'medium', as(response(new Uint8Array(), { 'content-type': 'image/png' })))).rejects.toThrow('empty');
  });
});
