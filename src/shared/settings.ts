import { z } from 'zod';
import { PROVIDER_KINDS } from './agent';

export const DEFAULT_ALLOW_HOSTS = ['x.com', '*.x.com', 'twitter.com', '*.twitter.com', 't.co'];

/**
 * A lowercase hostname, optionally prefixed with `*.` for its subdomains. The base always has at
 * least two labels, so no pattern can cover a whole public suffix (`*.com`).
 */
const AllowHostSchema = z
  .string()
  .max(253)
  .regex(/^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/, 'allowHosts entries must be lowercase hostnames, optionally prefixed with "*."');

/** An absolute path with no control characters: `binPath` is spawned, so a relative name (resolved off PATH) is not accepted. */
const BinPathSchema = z
  .string()
  .max(1024)
  .refine(
    (p) => /^\//.test(p) && ![...p].some((c) => (c.codePointAt(0) ?? 0) < 0x20 || (c.codePointAt(0) ?? 0) === 0x7f),
    'binPath must be an absolute path with no control characters',
  );

export const SettingsSchema = z.object({
  posting: z.object({ mode: z.enum(['confirm', 'autonomous']).default('confirm') }),
  /** Agent-made likes: a like is a public write on the user's account, so it is confirmed by default. */
  likes: z.object({ mode: z.enum(['auto', 'confirm']).default('confirm') }),
  /**
   * Agent-made bookmarks. A bookmark is private to the user, but it still writes to their account
   * and shapes what they come back to, so it is confirmed by default like a like.
   */
  bookmarks: z.object({ mode: z.enum(['auto', 'confirm']).default('confirm') }),
  /**
   * Agent-written page styles. CSS on the page the user is looking at can cover a control with an
   * invisible one, so what the agent writes is shown and confirmed before it is applied.
   */
  styles: z.object({ mode: z.enum(['confirm', 'autonomous']).default('confirm') }),
  /**
   * Custom views: whole replacement UIs the agent writes and XPilot renders over the X page. Showing
   * one takes over what the user is looking at, so it is previewed and confirmed like a stylesheet.
   * `active` is the view to bring back at the next start, and is cleared when it no longer loads.
   */
  views: z.object({
    active: z.string().max(40).nullable().default(null),
    mode: z.enum(['confirm', 'autonomous']).default('confirm'),
  }),
  library: z.object({ dir: z.string().nullable().default(null) }),
  agent: z.object({
    /** Which backend drives the agent; null until the user picks one in the first-run card. */
    provider: z.enum(PROVIDER_KINDS).nullable().default(null),
    codex: z.object({
      model: z.string().nullable().default('gpt-5.6-luna'),
      reasoningEffort: z.string().nullable().default('low'),
      approvalPolicy: z.enum(['untrusted', 'on-request']).default('on-request'),
      sandbox: z.enum(['read-only', 'workspace-write']).default('read-only'),
      webSearch: z.enum(['live', 'cached', 'disabled']).default('live'),
      /** Absolute path to the `codex` binary; null means auto-detect (PATH, common install dirs, login shell). */
      binPath: BinPathSchema.nullable().default(null),
    }),
    claude: z.object({
      model: z.string().nullable().default('claude-sonnet-5'),
      effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).nullable().default('low'),
      webSearch: z.enum(['on', 'off']).default('on'),
      /** Absolute path to the `claude` binary; null means auto-detect (PATH, common install dirs, login shell). */
      binPath: BinPathSchema.nullable().default(null),
    }),
  }),
  navigation: z.object({ allowHosts: z.array(AllowHostSchema).max(32).default(DEFAULT_ALLOW_HOSTS) }),
  /** Transcript retention: conversations beyond either limit are deleted, oldest first. */
  history: z.object({
    keepConversations: z.number().int().min(10).max(5000).default(200),
    keepDays: z.number().int().min(7).max(3650).default(90),
  }),
  /** One-time first-run card: false until the user dismisses it. */
  ui: z.object({ onboarded: z.boolean().default(false) }),
  window: z.object({
    bounds: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).nullable().default(null),
    /**
     * Where the user dragged the collapsed handle, as offsets from the window's top-left in the
     * window's own coordinate space; null leaves it in its default spot near the top-right corner.
     */
    handle: z.object({ x: z.number(), y: z.number() }).nullable().default(null),
  }),
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

// `binPath` is settable only through the file picker, which checks the file before it is stored.
const { binPath: _codexBinPath, ...codexPatchShape } = SettingsSchema.shape.agent.shape.codex.shape;
const codexShape = z.object(codexPatchShape);
const { binPath: _claudeBinPath, ...claudePatchShape } = SettingsSchema.shape.agent.shape.claude.shape;
const claudeShape = z.object(claudePatchShape);

/**
 * What a settings update may contain: every field of `SettingsSchema`, optional and validated by the
 * same rules, with unknown keys rejected. Derived from the schema so a new setting cannot be missed.
 * The cast restates the shape the schema was built from; the parse itself is real validation.
 */
export const SettingsPatchSchema = z.strictObject({
  posting: patchOf(SettingsSchema.shape.posting).optional(),
  likes: patchOf(SettingsSchema.shape.likes).optional(),
  bookmarks: patchOf(SettingsSchema.shape.bookmarks).optional(),
  styles: patchOf(SettingsSchema.shape.styles).optional(),
  views: patchOf(SettingsSchema.shape.views).optional(),
  library: patchOf(SettingsSchema.shape.library).optional(),
  agent: z
    .strictObject({
      provider: optionalField(SettingsSchema.shape.agent.shape.provider),
      codex: patchOf(codexShape).optional(),
      claude: patchOf(claudeShape).optional(),
    })
    .optional(),
  navigation: patchOf(SettingsSchema.shape.navigation).optional(),
  history: patchOf(SettingsSchema.shape.history).optional(),
  ui: patchOf(SettingsSchema.shape.ui).optional(),
  window: patchOf(SettingsSchema.shape.window).optional(),
}) as unknown as z.ZodType<DeepPartial<Settings>>;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function deepMerge<T>(base: T, patch: DeepPartial<T> | undefined): T {
  if (!isObj(base) || !isObj(patch)) return patch === undefined ? base : (patch as T);
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k], v as never) : v;
  }
  return out as T;
}

/**
 * Fills in missing nested objects so leaf-level defaults apply, then validates. Only the keys named
 * here survive, so a file written before the agent's thread state moved to `agent-state.json` still
 * loads: `threadId` and `threadToolsHash` are simply dropped.
 */
export function normalizeSettings(raw: unknown): Settings {
  const r = isObj(raw) ? raw : {};
  const agent = isObj(r.agent) ? { ...r.agent } : {};
  const codex = isObj(agent.codex) ? { ...agent.codex } : {};
  const claude = isObj(agent.claude) ? { ...agent.claude } : {};
  if (codex.approvalPolicy === 'never') delete codex.approvalPolicy;
  const ui = isObj(r.ui) ? r.ui : {};
  // A file written before there was a choice belongs to a user who was already on Codex; only a
  // genuinely new profile gets the null that raises the picker.
  if (agent.provider === undefined && ui.onboarded === true) agent.provider = 'codex';
  const shaped = {
    posting: isObj(r.posting) ? r.posting : {},
    likes: isObj(r.likes) ? r.likes : {},
    bookmarks: isObj(r.bookmarks) ? r.bookmarks : {},
    styles: isObj(r.styles) ? r.styles : {},
    views: isObj(r.views) ? r.views : {},
    library: isObj(r.library) ? r.library : {},
    agent: { ...agent, codex, claude },
    navigation: isObj(r.navigation) ? r.navigation : {},
    history: isObj(r.history) ? r.history : {},
    ui,
    window: isObj(r.window) ? r.window : {},
  };
  return SettingsSchema.parse(shaped);
}

export const DEFAULT_SETTINGS: Settings = normalizeSettings({});

export type PostingMode = Settings['posting']['mode'];
export type StylesMode = Settings['styles']['mode'];
export type ViewsMode = Settings['views']['mode'];
