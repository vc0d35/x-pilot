import { z } from 'zod';

export const DEFAULT_ALLOW_HOSTS = ['x.com', '*.x.com', 'twitter.com', '*.twitter.com', 't.co'];

/**
 * A lowercase hostname, optionally prefixed with `*.` for its subdomains. The base always has at
 * least two labels, so no pattern can cover a whole public suffix (`*.com`).
 */
const AllowHostSchema = z.string().max(253).regex(/^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/, 'allowHosts entries must be lowercase hostnames, optionally prefixed with "*."');

/** An absolute path with no control characters: `binPath` is spawned, so a relative name (resolved off PATH) is not accepted. */
const BinPathSchema = z.string().max(1024).refine((p) => /^\//.test(p) && ![...p].some((c) => (c.codePointAt(0) ?? 0) < 0x20 || (c.codePointAt(0) ?? 0) === 0x7f), 'binPath must be an absolute path with no control characters');

export const SettingsSchema = z.object({
  posting: z.object({ mode: z.enum(['confirm', 'autonomous']).default('confirm') }),
  /** Agent-made likes: a like is a public write on the user's account, so it is confirmed by default. */
  likes: z.object({ mode: z.enum(['auto', 'confirm']).default('confirm') }),
  library: z.object({ dir: z.string().nullable().default(null) }),
  agent: z.object({
    provider: z.literal('codex').default('codex'),
    codex: z.object({
      model: z.string().nullable().default(null),
      reasoningEffort: z.string().nullable().default(null),
      approvalPolicy: z.enum(['untrusted', 'on-request']).default('on-request'),
      sandbox: z.enum(['read-only', 'workspace-write']).default('read-only'),
      webSearch: z.enum(['live', 'cached', 'disabled']).default('live'),
      /** Absolute path to the `codex` binary; null means auto-detect (PATH, common install dirs, login shell). */
      binPath: BinPathSchema.nullable().default(null),
    }),
  }),
  navigation: z.object({ allowHosts: z.array(AllowHostSchema).max(32).default(DEFAULT_ALLOW_HOSTS) }),
  /** One-time first-run card: false until the user dismisses it. */
  ui: z.object({ onboarded: z.boolean().default(false) }),
  threadId: z.string().nullable().default(null),
  window: z.object({
    bounds: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).nullable().default(null),
  }),
  /** Fingerprint of the tool list the stored thread was started with; a mismatch forces a fresh thread. */
  threadToolsHash: z.string().nullable().default(null),
});
export type Settings = z.infer<typeof SettingsSchema>;

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** The same field, minus its default: a patch that omits a key must leave the stored value alone. */
function optionalField(schema: z.ZodTypeAny): z.ZodTypeAny {
  return (schema instanceof z.ZodDefault ? optionalField(schema.def.innerType as z.ZodTypeAny) : schema).optional();
}

function patchOf(schema: z.ZodObject<z.ZodRawShape>): z.ZodObject<z.ZodRawShape> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, field] of Object.entries(schema.shape)) shape[key] = optionalField(field as z.ZodTypeAny);
  return z.strictObject(shape);
}

const { binPath: _binPath, ...codexPatchShape } = SettingsSchema.shape.agent.shape.codex.shape;
const codexShape = z.object(codexPatchShape);

/**
 * What a settings update may contain: every field of `SettingsSchema`, optional and validated by the
 * same rules, with unknown keys rejected. Derived from the schema so a new setting cannot be missed.
 * The cast restates the shape the schema was built from; the parse itself is real validation.
 */
export const SettingsPatchSchema = z.strictObject({
  posting: patchOf(SettingsSchema.shape.posting).optional(),
  likes: patchOf(SettingsSchema.shape.likes).optional(),
  library: patchOf(SettingsSchema.shape.library).optional(),
  agent: z.strictObject({
    provider: optionalField(SettingsSchema.shape.agent.shape.provider),
    codex: patchOf(codexShape).optional(),
  }).optional(),
  navigation: patchOf(SettingsSchema.shape.navigation).optional(),
  ui: patchOf(SettingsSchema.shape.ui).optional(),
  threadId: optionalField(SettingsSchema.shape.threadId),
  window: patchOf(SettingsSchema.shape.window).optional(),
  threadToolsHash: optionalField(SettingsSchema.shape.threadToolsHash),
}) as unknown as z.ZodType<DeepPartial<Settings>>;

function isObj(v: unknown): v is Record<string, unknown> { return typeof v === 'object' && v !== null && !Array.isArray(v); }

export function deepMerge<T>(base: T, patch: DeepPartial<T> | undefined): T {
  if (!isObj(base) || !isObj(patch)) return (patch === undefined ? base : (patch as T));
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k], v as never) : v;
  }
  return out as T;
}

/** Fills in missing nested objects so leaf-level defaults apply, then validates. */
export function normalizeSettings(raw: unknown): Settings {
  const r = isObj(raw) ? raw : {};
  const agent = isObj(r.agent) ? { ...r.agent } : {};
  const codex = isObj(agent.codex) ? { ...agent.codex } : {};
  if (codex.approvalPolicy === 'never') delete codex.approvalPolicy;
  const shaped = {
    posting: isObj(r.posting) ? r.posting : {},
    likes: isObj(r.likes) ? r.likes : {},
    library: isObj(r.library) ? r.library : {},
    agent: { ...agent, codex },
    navigation: isObj(r.navigation) ? r.navigation : {},
    ui: isObj(r.ui) ? r.ui : {},
    threadId: r.threadId ?? null,
    window: isObj(r.window) ? r.window : {},
    threadToolsHash: r.threadToolsHash ?? null,
  };
  return SettingsSchema.parse(shaped);
}

export const DEFAULT_SETTINGS: Settings = normalizeSettings({});

export type PostingMode = Settings['posting']['mode'];

export const AUTONOMOUS_WARNING = 'Autonomous mode lets the agent post without asking you. Continue?';

/** Gate for switching posting mode: returns the mode to apply, or null when the user declined the warning. */
export function confirmPostingMode(next: PostingMode, confirmFn: (message: string) => boolean): PostingMode | null {
  if (next === 'autonomous' && !confirmFn(AUTONOMOUS_WARNING)) return null;
  return next;
}
