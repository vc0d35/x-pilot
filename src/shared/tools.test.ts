import { describe, it, expect } from 'vitest';
import { ToolSpecSchema, ToolResultSchema, ok, fail } from './tools';

describe('ToolSpecSchema', () => {
  it('accepts a minimal spec and defaults inputSchema', () => {
    const spec = ToolSpecSchema.parse({ name: 'x_get_page_state', description: 'Reads page state' });
    expect(spec.inputSchema).toEqual({ type: 'object', properties: {} });
  });
  it('rejects names with dashes', () => {
    expect(() => ToolSpecSchema.parse({ name: 'x-bad', description: 'd' })).toThrow();
  });
});

describe('ToolResultSchema', () => {
  it('round-trips ok() and fail()', () => {
    expect(ToolResultSchema.parse(ok({ a: 1 }))).toEqual({ success: true, content: { a: 1 } });
    expect(ToolResultSchema.parse(fail('boom'))).toEqual({ success: false, error: 'boom' });
  });
});
