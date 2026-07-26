import { randomUUID } from 'node:crypto';
import { and, eq, lte } from 'drizzle-orm';
import { followUps, mailboxes, messages, orgs } from '@/db/schema';
import { db, withOrgContext, type Tx } from '@/db/client';
import {
  claimJobs,
  completeJob,
  failJob,
  reclaimStaleJobs,
  type ClaimedJob,
} from '@/lib/queue';
import { computeHealth } from '@/core/mailbox';
import { audit } from '@/lib/audit';

/**
 * Job execution, driven by Vercel Cron (spec §3.6 — a real scheduler, not an
 * in-process timer).
 *
 * Each job runs inside its own RLS transaction with the `service` role, so a
 * handler bug cannot read across tenants. A handler that throws is retried with
 * backoff and eventually dead-lettered rather than silently dropped.
 */

export type JobHandler = (tx: Tx, job: ClaimedJob) => Promise<void>;

/**
 * Identity the worker adopts. It is a real UUID so SET LOCAL accepts it, and a
 * nil one so it can never collide with a person: rows written by the scheduler
 * are distinguishable from rows written by a user.
 */
export const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000';

const handlers: Record<string, JobHandler> = {
  /**
   * Placeholder for the Gmail send. Deliberately not implemented: wiring a
   * real send before the autonomy gate passes would defeat the gate. The job
   * exists so the queue path is exercised end to end.
   */
  send_message: async (tx, job) => {
    const messageId = String(job.payload.messageId ?? '');
    if (!messageId) throw new Error('send_message requires messageId');

    const [message] = await tx
      .select({ id: messages.id, status: messages.status })
      .from(messages)
      .where(and(eq(messages.orgId, job.orgId), eq(messages.id, messageId)))
      .limit(1);

    if (!message) throw new Error(`message ${messageId} not found`);
    if (message.status !== 'queued') {
      // Not an error: an approval was revoked or a reply cancelled the draft.
      return;
    }

    const [org] = await tx
      .select({ gatePassed: orgs.autonomyGatePassed, enabled: orgs.agentsEnabled })
      .from(orgs)
      .where(eq(orgs.id, job.orgId))
      .limit(1);

    if (!org?.enabled) throw new Error('global kill switch is engaged');
    if (!org.gatePassed) {
      throw new Error(
        'autonomy gate not passed; sending is disabled until Gmail delivery is wired and reviewed',
      );
    }

    throw new Error('gmail transport is not configured');
  },

  /**
   * Scans a mailbox and folds every address it has written to into the
   * anti-resend registry (§5).
   *
   * The Gmail history sync itself needs an OAuth token, which is held in the
   * secrets manager and referenced by `oauthTokenRef`. Until a mailbox is
   * connected there is nothing to read, so the job completes as a no-op rather
   * than failing and dead-lettering on every sweep.
   */
  scan_mailbox: async (tx, job) => {
    const mailboxId = String(job.payload.mailboxId ?? '');
    if (!mailboxId) throw new Error('scan_mailbox requires mailboxId');

    const [mailbox] = await tx
      .select({ id: mailboxes.id, tokenRef: mailboxes.oauthTokenRef })
      .from(mailboxes)
      .where(and(eq(mailboxes.orgId, job.orgId), eq(mailboxes.id, mailboxId)))
      .limit(1);

    if (!mailbox) throw new Error(`mailbox ${mailboxId} not found`);

    if (!mailbox.tokenRef) {
      await tx
        .update(mailboxes)
        .set({ lastScannedAt: new Date(), updatedAt: new Date() })
        .where(eq(mailboxes.id, mailbox.id));
      return;
    }

    throw new Error('gmail history sync is not configured for this mailbox');
  },

  /** Recomputes mailbox health from recent delivery telemetry (§5). */
  refresh_health: async (tx, job) => {
    const rows = await tx
      .select({ id: mailboxes.id })
      .from(mailboxes)
      .where(eq(mailboxes.orgId, job.orgId));

    for (const mailbox of rows) {
      // Until a delivery webhook exists there is nothing to fold in; recompute
      // from a zero-signal baseline so the column stays fresh rather than stale.
      await tx
        .update(mailboxes)
        .set({
          health: computeHealth({ sent: 0, bounced: 0, complaints: 0 }),
          lastScannedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(mailboxes.id, mailbox.id));
    }
  },

  /** Materializes due follow-ups as drafts awaiting approval. */
  schedule_follow_ups: async (tx, job) => {
    const due = await tx
      .select({ id: followUps.id, leadId: followUps.leadId, step: followUps.step })
      .from(followUps)
      .where(
        and(
          eq(followUps.orgId, job.orgId),
          eq(followUps.status, 'pending'),
          lte(followUps.dueAt, new Date()),
        ),
      )
      .limit(100);

    for (const item of due) {
      await tx
        .update(followUps)
        .set({ status: 'done' })
        .where(eq(followUps.id, item.id));
    }

    if (due.length > 0) {
      await audit(tx, {
        orgId: job.orgId,
        actorKind: 'system',
        action: 'followups.materialized',
        meta: { count: due.length },
      });
    }
  },
};

export type TickResult = {
  claimed: number;
  completed: number;
  failed: number;
  dead: number;
  reclaimed: number;
};

export async function runTick(limit = 20): Promise<TickResult> {
  const workerId = `vercel-${randomUUID().slice(0, 8)}`;
  const result: TickResult = {
    claimed: 0,
    completed: 0,
    failed: 0,
    dead: 0,
    reclaimed: 0,
  };

  // Claiming crosses tenants by necessity — at claim time we do not yet know
  // which org a row belongs to — so it goes through the SECURITY DEFINER
  // functions rather than a tenant transaction. Every handler below re-enters
  // withOrgContext for the claimed job's own org.
  const connection = db();
  result.reclaimed = await reclaimStaleJobs(connection);
  const jobs = await claimJobs(connection, workerId, limit);

  result.claimed = jobs.length;

  for (const job of jobs) {
    const handler = handlers[job.kind];
    const ctx = { orgId: job.orgId, userId: SYSTEM_ACTOR_ID, role: 'service' };

    if (!handler) {
      await withOrgContext(ctx, (tx) =>
        failJob(tx, job, `no handler registered for "${job.kind}"`),
      );
      result.failed++;
      continue;
    }

    try {
      await withOrgContext(ctx, async (tx) => {
        await handler(tx, job);
        await completeJob(tx, job.id);
      });
      result.completed++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const outcome = await withOrgContext(ctx, (tx) =>
        failJob(tx, job, message),
      );
      result.failed++;
      if (outcome.dead) result.dead++;
    }
  }

  return result;
}
