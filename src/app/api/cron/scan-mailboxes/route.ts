import { eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { mailboxes } from '@/db/schema';
import { db, withOrgContext } from '@/db/client';
import { authorizeCron, handleError, ok } from '@/lib/http';
import { enqueue } from '@/lib/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Hourly sweep that keeps the anti-resend registry and mailbox health current
 * (spec §5).
 *
 * It enqueues rather than scans inline: a Gmail history sync per mailbox is
 * unbounded work, and a cron invocation has a wall-clock budget. The queue
 * gives each mailbox its own retry envelope, so one expired token does not
 * stall the sweep for every other mailbox.
 */
export async function GET(req: Request) {
  try {
    authorizeCron(req);

    const targets = await db().execute<{ org_id: string; owner_id: string }>(
      sql`SELECT * FROM app.list_schedulable_orgs()`,
    );

    // Hour-granular so a retried cron invocation reuses the same keys and the
    // unique index collapses it to a no-op.
    const slot = new Date().toISOString().slice(0, 13);
    let enqueued = 0;

    for (const target of targets) {
      await withOrgContext(
        { orgId: target.org_id, userId: target.owner_id, role: 'service' },
        async (tx) => {
          const rows = await tx
            .select({ id: mailboxes.id })
            .from(mailboxes)
            .where(eq(mailboxes.orgId, target.org_id));

          for (const mailbox of rows) {
            const result = await enqueue(tx, {
              orgId: target.org_id,
              kind: 'scan_mailbox',
              payload: { mailboxId: mailbox.id },
              idempotencyKey: `scan:${mailbox.id}:${slot}`,
            });
            if (result.enqueued) enqueued++;
          }

          const health = await enqueue(tx, {
            orgId: target.org_id,
            kind: 'refresh_health',
            payload: {},
            idempotencyKey: `health:${target.org_id}:${slot}`,
          });
          if (health.enqueued) enqueued++;

          const followUps = await enqueue(tx, {
            orgId: target.org_id,
            kind: 'schedule_follow_ups',
            payload: {},
            idempotencyKey: `followups:${target.org_id}:${slot}`,
          });
          if (followUps.enqueued) enqueued++;
        },
      );
    }

    return ok({ orgs: targets.length, enqueued });
  } catch (err) {
    return handleError(err);
  }
}
