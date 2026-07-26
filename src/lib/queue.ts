import { eq, sql } from 'drizzle-orm';
import { jobs } from '@/db/schema';
import type { Tx } from '@/db/client';

/**
 * Durable job queue (spec §3.6).
 *
 * BullMQ + Redis assumes a long-lived worker process, which a serverless
 * deployment does not have. The same guarantees are provided by Postgres:
 * `SELECT ... FOR UPDATE SKIP LOCKED` gives exclusive claims, the unique index
 * on (org_id, idempotency_key) gives at-most-once enqueue, and attempts /
 * max_attempts give bounded retries with a dead-letter terminus. The scheduler
 * is Vercel Cron — real infrastructure, not an in-process timer.
 */

export type JobKind =
  | 'send_message'
  | 'scan_mailbox'
  | 'classify_reply'
  | 'schedule_follow_ups'
  | 'verify_email'
  | 'refresh_health';

export type EnqueueInput = {
  orgId: string;
  kind: JobKind;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  runAt?: Date;
  maxAttempts?: number;
};

export type ClaimedJob = {
  id: string;
  orgId: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
};

/**
 * Enqueues unless an identical unit of work already exists. Returns whether a
 * row was created so callers can distinguish "scheduled" from "already
 * scheduled" without a second query.
 */
export async function enqueue(
  tx: Tx,
  input: EnqueueInput,
): Promise<{ enqueued: boolean }> {
  const inserted = await tx
    .insert(jobs)
    .values({
      orgId: input.orgId,
      kind: input.kind,
      payload: input.payload,
      idempotencyKey: input.idempotencyKey,
      runAt: input.runAt ?? new Date(),
      maxAttempts: input.maxAttempts ?? 5,
    })
    .onConflictDoNothing({ target: [jobs.orgId, jobs.idempotencyKey] })
    .returning({ id: jobs.id });

  return { enqueued: inserted.length > 0 };
}

/**
 * Claims up to `limit` due jobs for this worker.
 *
 * Runs through app.claim_jobs (SECURITY DEFINER) because the worker has to
 * select across tenants before it knows whose context to adopt — see
 * db/migrations/0003_scheduler.sql. SKIP LOCKED inside that function means two
 * overlapping cron invocations take disjoint sets rather than blocking or
 * double-processing. The caller re-enters withOrgContext per job before
 * touching any business data.
 */
export async function claimJobs(
  executor: Pick<Tx, 'execute'>,
  workerId: string,
  limit = 20,
): Promise<ClaimedJob[]> {
  const rows = await executor.execute<{
    id: string;
    org_id: string;
    kind: string;
    payload: Record<string, unknown>;
    attempts: number;
    max_attempts: number;
  }>(sql`SELECT * FROM app.claim_jobs(${workerId}, ${limit})`);

  return rows.map((r) => ({
    id: r.id,
    orgId: r.org_id,
    kind: r.kind,
    payload: r.payload,
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
  }));
}

export async function completeJob(tx: Tx, jobId: string): Promise<void> {
  await tx
    .update(jobs)
    .set({ status: 'done', lockedAt: null, lockedBy: null, lastError: null })
    .where(eq(jobs.id, jobId));
}

/** Exponential backoff with a 1h ceiling: 1m, 2m, 4m, 8m, ... */
export function backoffMs(attempts: number): number {
  return Math.min(60_000 * 2 ** Math.max(0, attempts - 1), 3_600_000);
}

/**
 * Records a failure. Once attempts reach maxAttempts the job moves to `dead`
 * rather than retrying forever — a dead-letter row a human can inspect.
 */
export async function failJob(
  tx: Tx,
  job: ClaimedJob,
  error: string,
): Promise<{ dead: boolean }> {
  const dead = job.attempts >= job.maxAttempts;
  await tx
    .update(jobs)
    .set({
      status: dead ? 'dead' : 'pending',
      runAt: dead ? new Date() : new Date(Date.now() + backoffMs(job.attempts)),
      lockedAt: null,
      lockedBy: null,
      lastError: error.slice(0, 2000),
    })
    .where(eq(jobs.id, job.id));
  return { dead };
}

/**
 * Releases jobs whose worker died mid-run so they become claimable again.
 * Cross-tenant for the same reason as claimJobs.
 */
export async function reclaimStaleJobs(
  executor: Pick<Tx, 'execute'>,
  olderThanMinutes = 15,
): Promise<number> {
  const rows = await executor.execute<{ reclaim_stale_jobs: number }>(
    sql`SELECT * FROM app.reclaim_stale_jobs(${olderThanMinutes})`,
  );
  return Number(rows[0]?.reclaim_stale_jobs ?? 0);
}
