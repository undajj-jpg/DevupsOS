import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Liveness + database reachability.
 *
 * Unauthenticated, so the response body stays bland — a probe must not become
 * a way to fingerprint the database or leak a connection string. The reason is
 * logged instead, where an operator can read it: a health check that reports
 * "degraded" and nothing else tells you the system is broken without telling
 * you why, which is the least useful moment to be withholding information.
 */
export async function GET() {
  try {
    await db().execute(sql`select 1`);
    return Response.json({ status: 'ok' });
  } catch (err) {
    console.error(
      '[health] database check failed:',
      err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    );
    return Response.json({ status: 'degraded' }, { status: 503 });
  }
}
