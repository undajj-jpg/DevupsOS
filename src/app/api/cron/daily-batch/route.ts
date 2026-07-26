import { sql } from 'drizzle-orm';
import { db, withOrgContext } from '@/db/client';
import { authorizeCron, handleError, ok } from '@/lib/http';
import { prepareTodaysBatch } from '@/core/sendPipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Prepares each org's daily batch of drafts on weekday mornings.
 *
 * Enumerating tenants has to happen before any tenant context exists, so it
 * goes through app.list_schedulable_orgs() — a SECURITY DEFINER function that
 * returns only (org, owner) pairs. Each org's work then runs inside that org's
 * RLS context with the owner as the acting identity.
 */
export async function GET(req: Request) {
  try {
    authorizeCron(req);

    const targets = await db().execute<{ org_id: string; owner_id: string }>(
      sql`SELECT * FROM app.list_schedulable_orgs()`,
    );

    const campaignKey = `daily-${new Date().toISOString().slice(0, 10)}`;
    const results: {
      orgId: string;
      prepared: number;
      skipped: number;
      error?: string;
    }[] = [];

    for (const target of targets) {
      try {
        const outcome = await withOrgContext(
          { orgId: target.org_id, userId: target.owner_id, role: 'service' },
          (tx) =>
            prepareTodaysBatch(tx, {
              orgId: target.org_id,
              userId: target.owner_id,
              campaignKey,
            }),
        );
        results.push({
          orgId: target.org_id,
          prepared: outcome.prepared,
          skipped: outcome.skipped.length,
        });
      } catch (err) {
        // One tenant's failure must not stop the rest of the run.
        results.push({
          orgId: target.org_id,
          prepared: 0,
          skipped: 0,
          error: err instanceof Error ? err.message : 'unknown error',
        });
      }
    }

    return ok({ orgs: results.length, campaignKey, results });
  } catch (err) {
    return handleError(err);
  }
}
