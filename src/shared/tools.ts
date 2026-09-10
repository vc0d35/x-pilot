import { z } from 'zod';

export const JsonSchemaSchema = z.record(z.string(), z.unknown());

export const ToolSpecSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9_]+$/),
  description: z.string().min(1),
  inputSchema: JsonSchemaSchema.default({ type: 'object', properties: {} }),
  annotations: z
    .object({ readOnlyHint: z.boolean().optional(), destructiveHint: z.boolean().optional(), internal: z.boolean().optional() })
    .optional(),
});
export type ToolSpec = z.infer<typeof ToolSpecSchema>;

export const ToolResultSchema = z.discriminatedUnion('success', [
  z.object({ success: z.literal(true), content: z.unknown(), warning: z.string().optional() }),
  z.object({ success: z.literal(false), error: z.string() }),
]);
export type ToolResult = z.infer<typeof ToolResultSchema>;

/**
 * Who asked for a tool call. The model's own calls are `agent`; a call a custom view made through
 * its bridge is `view`, and carries the view's name so a card can say whose request it is. It never
 * reaches the model-facing spec: it is context about the caller, not an argument.
 */
export type CallOrigin = { kind: 'agent' } | { kind: 'view'; name: string };

/** What a caller may say about a call beyond its arguments. */
export interface ToolCallOptions {
  signal?: AbortSignal;
  origin?: CallOrigin;
}

/** The view a call came from, or null when it is the agent's own. */
export function callingView(ctx: { origin?: CallOrigin }): string | null {
  return ctx.origin?.kind === 'view' ? ctx.origin.name : null;
}

/**
 * An integer argument that is clamped into [min, max] instead of rejected: the model guesses
 * sizes, and a guess above the cap should still get an answer.
 */
export function clampedInt(min: number, max: number, description: string, fallback?: number) {
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  const text = `${description} (${min} to ${max}; values outside are clamped)`;
  if (fallback === undefined)
    return z
      .int()
      .optional()
      .transform((n) => (n === undefined ? undefined : clamp(n)))
      .describe(text);
  return z.int().default(fallback).transform(clamp).describe(text);
}

export const ok = (content: unknown, warning?: string): ToolResult =>
  warning ? { success: true, content, warning } : { success: true, content };
export const fail = (error: string): ToolResult => ({ success: false, error });

/** A tool's arguments: one zod object, from which the JSON schema the model sees is derived. */
export interface ToolDef<S extends z.ZodObject = z.ZodObject> {
  name: string;
  description: string;
  args: S;
  annotations?: ToolSpec['annotations'];
}

/**
 * A tool implementation. `Ctx` is whatever the host passes (main: services; preload: nothing).
 * `execute` receives arguments already parsed by `args`, so it never coerces or defaults them
 * itself; call it through `runTool` (or a `ToolSource` that does) rather than directly.
 * `signal` aborts when the user stops the turn: tools that move a window or write check it before
 * every effect.
 */
export interface ToolModule<Ctx = void, A = Record<string, unknown>> {
  spec: ToolSpec;
  args: z.ZodType;
  execute(args: A, ctx: Ctx, signal?: AbortSignal): Promise<ToolResult>;
}

/** `.int()` carries JavaScript's safe-integer range, which was never part of the published schema. */
function dropSafeIntegerBounds(schema: Record<string, unknown>): void {
  if (schema.maximum === Number.MAX_SAFE_INTEGER) delete schema.maximum;
  if (schema.minimum === -Number.MAX_SAFE_INTEGER) delete schema.minimum;
}

/** The model-facing JSON schema for a tool's arguments: plain draft-agnostic JSON Schema, as Codex expects. */
export function toJsonSchema(args: z.ZodType): Record<string, unknown> {
  const schema = z.toJSONSchema(args, {
    io: 'input',
    override: ({ jsonSchema }) => dropSafeIntegerBounds(jsonSchema as Record<string, unknown>),
  }) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

export function toolSpec(def: ToolDef): ToolSpec {
  const spec: ToolSpec = { name: def.name, description: def.description, inputSchema: toJsonSchema(def.args) };
  if (def.annotations) spec.annotations = def.annotations;
  return spec;
}

/**
 * One tool as one object: the schema is written once and `spec.inputSchema` is derived from it.
 * `Ctx` is inferred from `execute`'s context parameter, so annotate that parameter even where the
 * tool ignores it.
 */
export function defineTool<Ctx, S extends z.ZodObject>(
  def: ToolDef<S> & { execute: (args: z.output<S>, ctx: Ctx, signal?: AbortSignal) => Promise<ToolResult> },
): ToolModule<Ctx, z.output<S>> {
  return { spec: toolSpec(def), args: def.args, execute: def.execute };
}

const summarise = (error: z.ZodError): string =>
  error.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)).join('; ');

/**
 * The one place raw arguments become typed ones. A model that sends the wrong shape gets a failure
 * describing it, not an exception and not a silently coerced value.
 */
export async function runTool<Ctx>(module: ToolModule<Ctx>, rawArgs: unknown, ctx: Ctx, signal?: AbortSignal): Promise<ToolResult> {
  const parsed = module.args.safeParse(rawArgs ?? {});
  if (!parsed.success) return fail(`Invalid arguments for ${module.spec.name}: ${summarise(parsed.error)}`);
  return module.execute(parsed.data as Record<string, unknown>, ctx, signal);
}
