import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Liveness + database reachability. Intentionally unauthenticated and bland. */
export async function GET() {
  try {
    await db().execute(sql`select 1`);
    return Response.json({ status: 'ok' });
  } catch {
    return Response.json({ status: 'degraded' }, { status: 503 });
  }
}
