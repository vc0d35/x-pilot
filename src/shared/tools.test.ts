import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ToolSpecSchema, ToolResultSchema, defineTool, ok, fail, runTool } from './tools';

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

describe('defineTool', () => {
  const seen: unknown[] = [];
  const tool = defineTool({
    name: 'xpilot_demo',
    description: 'demo',
    args: z.strictObject({
      url: z.string(),
      limit: z.int().min(1).max(10).default(3),
      mode: z.enum(['a', 'b']).optional().describe('which one'),
    }),
    annotations: { readOnlyHint: true },
    execute: async (args, _ctx: void) => {
      seen.push(args);
      return ok(args);
    },
  });

  it('derives the input schema from the arguments, with no $schema and nothing required by a default', () => {
    expect(tool.spec).toEqual({
      name: 'xpilot_demo',
      description: 'demo',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 10, default: 3 },
          mode: { type: 'string', enum: ['a', 'b'], description: 'which one' },
        },
        required: ['url'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
    });
  });

  it('runTool hands execute parsed arguments with the declared defaults applied', async () => {
    await expect(runTool(tool, { url: 'u' }, undefined)).resolves.toEqual(ok({ url: 'u', limit: 3 }));
  });

  it('runTool fails with the issues instead of throwing, and does not run the tool', async () => {
    const before = seen.length;
    expect(await runTool(tool, { limit: 99 }, undefined)).toEqual(
      fail(
        'Invalid arguments for xpilot_demo: url: Invalid input: expected string, received undefined; limit: Too big: expected number to be <=10',
      ),
    );
    expect(await runTool(tool, 'not an object', undefined)).toMatchObject({ success: false });
    expect(seen).toHaveLength(before);
  });
});
