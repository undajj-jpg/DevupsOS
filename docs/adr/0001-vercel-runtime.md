# ADR 0001 — Vercel runtime substitutions

**Status:** accepted
**Date:** 2026-07-26

## Context

The master spec (§2) fixes the stack as Fastify or NestJS for the API and
workers, BullMQ + Redis for queues, and an infrastructure-level scheduler. The
deployment target chosen for this build is Vercel.

Those two things conflict on one point: Vercel has no long-lived process. A
BullMQ worker is a daemon that holds a Redis connection and blocks on `BRPOP`.
Serverless functions are invoked, run, and are frozen. There is nowhere for that
daemon to live.

## Decision

Substitute three components, preserving the properties the spec's guardrails
actually depend on rather than the specific technology.

| Spec | Here | Why the guardrail still holds |
| --- | --- | --- |
| Fastify / NestJS | Next.js App Router route handlers | Both are just HTTP handlers. Auth, validation and RLS context are applied by one wrapper (`src/lib/http.ts`) that every route goes through, so no handler can skip them. |
| BullMQ + Redis | Postgres job table | `SELECT ... FOR UPDATE SKIP LOCKED` gives exclusive claims across concurrent workers. A unique index on `(org_id, idempotency_key)` gives at-most-once enqueue. `attempts`/`max_attempts` give bounded retries with a `dead` terminus. §3.6 asks for idempotency, retries and dead-lettering — all three are present. |
| Infrastructure scheduler | Vercel Cron (`vercel.json`) | §3.6 says the scheduler must not be in-app. Vercel Cron is external infrastructure that calls an authenticated HTTP endpoint, which is the property being asked for. It is not a `setInterval`. |

Postgres also removes a whole class of failure: the queue and the business data
commit in the same transaction. A job enqueued alongside a row cannot survive a
rollback of that row, which a separate Redis instance cannot guarantee.

## Consequences

**Good**

- One datastore instead of two. Fewer credentials, fewer failure modes, one
  backup and restore story.
- Jobs are transactional with the data they act on.
- The queue is inspectable with SQL; a dead-lettered job is a row, not a Redis
  key a human has to go spelunking for.

**Bad**

- Job latency is bounded by the cron interval — five minutes for the main tick,
  not milliseconds. Fine for outreach; wrong for anything interactive.
- Postgres polling is heavier per job than Redis. At the volumes an outbound
  engine produces (hundreds to low thousands of jobs a day) this does not
  matter. At a hundred thousand it would.
- Each cron invocation has a wall-clock budget, so long work must be split
  across ticks rather than run to completion in one pass.

**Reversal path**

`src/lib/queue.ts` is the only module that knows how jobs are stored. Moving to
BullMQ means reimplementing `enqueue` / `claimJobs` / `completeJob` / `failJob`
against Redis and running `runTick` as a daemon loop instead of a cron handler.
Nothing in `src/core/` would change.

## Other consequences of the target

Two more things follow from serverless, and were handled rather than assumed
away:

- **Rate limiting cannot be in process memory.** Every request may land on a
  cold instance, so an in-memory bucket enforces nothing. It is a Postgres
  fixed-window counter instead (`db/migrations/0002_rate_limits.sql`).
- **The scheduler has to enumerate tenants before adopting one's identity**,
  which RLS correctly forbids. Rather than granting the worker a blanket
  bypass, three `SECURITY DEFINER` functions expose exactly the cross-tenant
  operations needed — list schedulable orgs, claim jobs, reclaim stale jobs —
  and they return envelopes, not business rows
  (`db/migrations/0003_scheduler.sql`).
