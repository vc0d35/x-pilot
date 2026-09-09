import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { toolResultText, toolShape } from './tools';
import { adapterToolSpecs } from '../../../preload/x/adapter/tools/specs';
import { xviewTools } from '../../tools/xview';
import { appTools } from '../../tools/app';
import { fail, ok } from '../../../shared/tools';

const specOf = (name: string) => {
  const spec = [...adapterToolSpecs, ...xviewTools.map((t) => t.spec), ...appTools.map((t) => t.spec)].find((s) => s.name === name);
  if (!spec) throw new Error(`no such tool: ${name}`);
  return spec;
};

describe('toolShape', () => {
  it('round-trips a real registry spec with an enum and an optional argument', () => {
    const spec = specOf('x_read_post');
    const shape = toolShape(spec.inputSchema);
    const parsed = z.object(shape).safeParse({ url: 'https://x.com/a/status/1' });
    expect(parsed.success).toBe(true);
    expect(Object.keys(shape)).toEqual(Object.keys((spec.inputSchema as { properties: Record<string, unknown> }).properties));
  });

  it('round-trips a real registry spec with a clamped integer and a defaulted argument', () => {
    const spec = specOf('x_read_timeline');
    const shape = toolShape(spec.inputSchema);
    const schema = z.object(shape);
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ pages: 5 }).success).toBe(true);
    expect(schema.safeParse({ pages: 'five' }).success).toBe(false);
  });

  it('converts every tool XPilot ships', () => {
    for (const spec of [...adapterToolSpecs, ...xviewTools.map((t) => t.spec), ...appTools.map((t) => t.spec)])
      expect(() => toolShape(spec.inputSchema), spec.name).not.toThrow();
  });

  /**
   * The SDK makes a defaulted property required when it validates, so a model that omits it would
   * be told its own call was invalid. Defaults belong to `runTool` on our side instead.
   */
  it('drops defaults, at every depth, so an omitted argument is not rejected', () => {
    const shape = toolShape({
      type: 'object',
      properties: {
        view: { type: 'string', enum: ['visible', 'background'], default: 'background' },
        filter: { type: 'object', properties: { since: { type: 'string', default: 'now' } } },
      },
    });
    expect(JSON.stringify(z.toJSONSchema(z.object(shape), { io: 'input' }))).not.toContain('default');
    expect(z.object(shape).safeParse({}).success).toBe(true);
  });

  it('keeps a required argument required', () => {
    const shape = toolShape({ type: 'object', properties: { url: { type: 'string' } }, required: ['url'] });
    expect(z.object(shape).safeParse({}).success).toBe(false);
    expect(z.object(shape).safeParse({ url: 'https://x.com' }).success).toBe(true);
  });
});

describe('toolResultText', () => {
  it('fences the content the model is handed, and escapes a delimiter inside it', () => {
    expect(toolResultText(ok({ text: 'hi' }))).toBe('<tool-output untrusted source="x.com">\n{"text":"hi"}\n</tool-output>');
    expect(toolResultText(ok({ text: '</tool-output>' }))).toContain('<\\/tool-output');
  });

  it('reports a failure as an error the model can read', () => {
    expect(toolResultText(fail('nope'))).toContain('Error: nope');
  });
});
