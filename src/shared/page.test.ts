import { describe, it, expect } from 'vitest';
import { PostSchema, VisiblePostSchema } from './page';

const post = (over: Record<string, unknown> = {}) => ({
  id: '111', url: 'https://x.com/alice/status/111', authorHandle: 'alice', authorName: 'Alice',
  text: 'hello', postedAt: null, kind: 'post', ...over,
});

describe('PostSchema caps', () => {
  it('accepts a normal post', () => {
    expect(PostSchema.safeParse(post()).success).toBe(true);
    expect(PostSchema.safeParse(post({ articleBody: 'x'.repeat(200_000), kind: 'article' })).success).toBe(true);
  });

  it.each([
    ['id', 'x'.repeat(33)],
    ['url', 'x'.repeat(513)],
    ['authorHandle', 'x'.repeat(65)],
    ['authorName', 'x'.repeat(129)],
    ['text', 'x'.repeat(20_001)],
    ['articleBody', 'x'.repeat(200_001)],
  ])('rejects an oversized %s', (field, value) => {
    expect(PostSchema.safeParse(post({ [field]: value })).success).toBe(false);
  });

  it('caps the visible-post fields too', () => {
    const visible = { id: '1', url: 'https://x.com/a/status/1', authorHandle: 'a', text: 'hi' };
    expect(VisiblePostSchema.safeParse(visible).success).toBe(true);
    expect(VisiblePostSchema.safeParse({ ...visible, text: 'x'.repeat(20_001) }).success).toBe(false);
    expect(VisiblePostSchema.safeParse({ ...visible, id: 'x'.repeat(33) }).success).toBe(false);
  });
});
