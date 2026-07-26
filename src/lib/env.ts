import { z } from 'zod';

/**
 * All configuration comes from the environment, which is populated by the
 * secrets manager (Doppler / AWS SM) or Vercel's encrypted env store.
 * Nothing here has a hardcoded fallback that could ship a real credential
 * (spec §3.1) — missing values fail loudly at boot instead.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  /** Signs session cookies. Rotate by issuing a new value; sessions expire. */
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be >= 32 chars'),

  /** Bearer token for the MCP surface (§3.3 — never a query param). */
  MCP_TOKEN: z.string().min(32).optional(),

  /** Shared secret Vercel Cron sends as `Authorization: Bearer`. */
  CRON_SECRET: z.string().min(16).optional(),

  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-opus-5'),

  ANYMAIL_FINDER_API_KEY: z.string().optional(),
  APOLLO_API_KEY: z.string().optional(),

  APP_URL: z.string().url().default('http://localhost:3000'),

  /** Belt-and-braces switch: forces suggestion mode regardless of DB state. */
  FORCE_SUGGESTION_MODE: z
    .string()
    .optional()
    .transform((v) => v !== 'false'),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration — ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test seam: clears the memoized parse so tests can vary process.env. */
export function resetEnvCache(): void {
  cached = null;
}
