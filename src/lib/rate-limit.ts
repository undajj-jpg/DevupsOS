import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

/**
 * Fixed-window rate limiting backed by Postgres (spec §3.3).
 *
 * Runs outside any tenant transaction because the calls that most need
 * throttling — login, MCP bearer auth — happen before an org context exists.
 */

export type RateLimitResult = {
  allowed: boolean;
  hits: number;
  resetsAt: Date;
};

/** Buckets are hashed so raw tokens and IPs are never written to the table. */
export function bucketKey(scope: string, identifier: string): string {
  const digest = createHash('sha256').update(identifier).digest('hex').slice(0, 32);
  return `${scope}:${digest}`;
}

export async function rateLimit(
  scope: string,
  identifier: string,
  opts: { limit: number; windowSeconds: number },
): Promise<RateLimitResult> {
  const rows = await db().execute<{
    allowed: boolean;
    hits: number;
    resets_at: string;
  }>(sql`
    SELECT * FROM app.rate_limit_hit(
      ${bucketKey(scope, identifier)},
      ${opts.windowSeconds},
      ${opts.limit}
    )
  `);

  const row = rows[0];
  if (!row) {
    // Fail closed: if the limiter itself is broken we do not hand out an
    // unlimited allowance.
    return { allowed: false, hits: 0, resetsAt: new Date(Date.now() + 60_000) };
  }
  return {
    allowed: row.allowed,
    hits: Number(row.hits),
    resetsAt: new Date(row.resets_at),
  };
}

export const LIMITS = {
  login: { limit: 10, windowSeconds: 300 },
  mcp: { limit: 120, windowSeconds: 60 },
  api: { limit: 300, windowSeconds: 60 },
} as const;
