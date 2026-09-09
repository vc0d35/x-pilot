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

export const ok = (content: unknown, warning?: string): ToolResult => (warning ? { success: true, content, warning } : { success: true, content });
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
  def: ToolDef<S> & { execute(args: z.output<S>, ctx: Ctx, signal?: AbortSignal): Promise<ToolResult> },
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
