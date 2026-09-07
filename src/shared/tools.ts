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
  z.object({ success: z.literal(true), content: z.unknown() }),
  z.object({ success: z.literal(false), error: z.string() }),
]);
export type ToolResult = z.infer<typeof ToolResultSchema>;

export const ok = (content: unknown): ToolResult => ({ success: true, content });
export const fail = (error: string): ToolResult => ({ success: false, error });

/** A tool implementation. `Ctx` is whatever the host passes (main: services; preload: nothing). */
export interface ToolModule<Ctx = void> {
  spec: ToolSpec;
  execute(args: Record<string, unknown>, ctx: Ctx): Promise<ToolResult>;
}
