import { z } from 'zod';
import type { ToolResult, ToolSpec } from '../../../shared/tools';
import { wrapToolOutput } from '../fence';

/** The MCP content block a tool handler answers with; matches the SDK's `CallToolResult`. */
export interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

/** The subset of `tool()` from the Claude Agent SDK that we use, so tests can pass a stub. */
export type DefineSdkTool = (
  name: string,
  description: string,
  shape: Record<string, z.ZodType>,
  handler: (args: Record<string, unknown>) => Promise<McpToolResult>,
) => unknown;

/**
 * The JSON schema as the Zod shape `tool()` wants. Defaults are dropped on the way: the SDK turns a
 * defaulted property into a required one at validation time, so a model that omits it would get an
 * error instead of the default. Our own `runTool` re-parses the arguments against the tool's real
 * schema, which is where defaults are applied anyway.
 */
export function toolShape(inputSchema: Record<string, unknown>): Record<string, z.ZodType> {
  const schema = z.fromJSONSchema(withoutDefaults(inputSchema) as Parameters<typeof z.fromJSONSchema>[0]);
  return (schema as z.ZodObject).shape;
}

function withoutDefaults(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutDefaults);
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === 'default') continue;
    out[k] = withoutDefaults(v);
  }
  return out;
}

/** The text the model sees for one tool result: the content as JSON, or the error, fenced. */
export function toolResultText(result: ToolResult): string {
  return wrapToolOutput(result.success ? JSON.stringify(result.content) : `Error: ${result.error}`);
}

export interface SdkToolDeps {
  define: DefineSdkTool;
  call(spec: ToolSpec, args: Record<string, unknown>): Promise<ToolResult>;
}

/** One SDK tool per spec; a schema we cannot convert names the tool rather than failing anonymously. */
export function sdkTools(specs: ToolSpec[], deps: SdkToolDeps): unknown[] {
  return specs.map((spec) => {
    let shape: Record<string, z.ZodType>;
    try {
      shape = toolShape(spec.inputSchema);
    } catch (err) {
      throw new Error(`Could not convert the schema of ${spec.name}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }
    return deps.define(spec.name, spec.description, shape, async (args) => {
      const result = await deps.call(spec, args ?? {});
      return { content: [{ type: 'text', text: toolResultText(result) }], isError: !result.success };
    });
  });
}
