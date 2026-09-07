import { z } from 'zod';

export const DEFAULT_ALLOW_HOSTS = ['x.com', '*.x.com', 'twitter.com', '*.twitter.com', 't.co'];

export const SettingsSchema = z.object({
  posting: z.object({ mode: z.enum(['confirm', 'autonomous']).default('confirm') }),
  library: z.object({ dir: z.string().nullable().default(null) }),
  agent: z.object({
    provider: z.literal('codex').default('codex'),
    codex: z.object({
      model: z.string().nullable().default(null),
      reasoningEffort: z.string().nullable().default(null),
      approvalPolicy: z.enum(['untrusted', 'on-request', 'never']).default('on-request'),
      sandbox: z.enum(['read-only', 'workspace-write']).default('read-only'),
    }),
  }),
  navigation: z.object({ allowHosts: z.array(z.string()).default(DEFAULT_ALLOW_HOSTS) }),
  threadId: z.string().nullable().default(null),
});
export type Settings = z.infer<typeof SettingsSchema>;

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

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
  const shaped = {
    posting: isObj(r.posting) ? r.posting : {},
    library: isObj(r.library) ? r.library : {},
    agent: { ...(isObj(r.agent) ? r.agent : {}), codex: isObj(r.agent) && isObj((r.agent as Record<string, unknown>).codex) ? (r.agent as Record<string, unknown>).codex : {} },
    navigation: isObj(r.navigation) ? r.navigation : {},
    threadId: r.threadId ?? null,
  };
  return SettingsSchema.parse(shaped);
}

export const DEFAULT_SETTINGS: Settings = normalizeSettings({});
