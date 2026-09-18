import { describe, it, expect, vi } from 'vitest';
import { viewImage } from './view-image';
import type { AppToolCtx } from './context';

const ctx = (fetchImage: AppToolCtx['fetchImage']) => ({ fetchImage }) as unknown as AppToolCtx;

describe('x_view_image', () => {
  it('hands the picture over beside the result, never inside it', async () => {
    const fetchImage = vi.fn(async () => ({ mimeType: 'image/jpeg', data: 'AQID' }));
    const r = await viewImage.execute({ url: 'https://pbs.twimg.com/media/a?format=jpg', detail: 'high' }, ctx(fetchImage));
    expect(fetchImage).toHaveBeenCalledWith('https://pbs.twimg.com/media/a?format=jpg', 'high', undefined);
    expect(r).toEqual({
      success: true,
      content: { url: 'https://pbs.twimg.com/media/a?format=jpg', mimeType: 'image/jpeg', attached: true },
      images: [{ mimeType: 'image/jpeg', data: 'AQID' }],
    });
    expect(JSON.stringify((r as { content: unknown }).content)).not.toContain('AQID');
  });

  it('asks for the medium rendition by default, and says why a picture could not be had', async () => {
    const fetchImage = vi.fn(async () => {
      throw new Error('Not an image on X’s image CDN (https://pbs.twimg.com/…)');
    });
    const r = await viewImage.execute({ url: 'https://evil.test/a.png', detail: undefined }, ctx(fetchImage));
    expect(fetchImage).toHaveBeenCalledWith('https://evil.test/a.png', 'medium', undefined);
    expect(r).toEqual({ success: false, error: 'Not an image on X’s image CDN (https://pbs.twimg.com/…)' });
  });
});
