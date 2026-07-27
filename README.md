# DevUps Growth OS

Outbound growth platform for DevUps (nearshore staff augmentation): source leads,
verify addresses, draft personalized first touches, triage replies, and hand a
human the decision to actually send anything.

Built from `specs/master-build-spec.md` in the order that spec prescribes —
Fase 0 (foundation) and Fase 1 (núcleo) are implemented. Fases 2–4 are not, and
the reasons are in [`docs/STATUS.md`](docs/STATUS.md).

## What actually works today

- **Multi-tenant core** — orgs, users, roles, mailboxes, accounts, contacts,
  leads, funnels, messages, replies, follow-ups, suppression, agents, jobs,
  audit log. Isolation is enforced by Postgres RLS, not by application code.
- **Blocking pre-send compliance** — suppression (address and whole-domain),
  the anti-resend registry, per-lead idempotency keys, and reply-cuts-cadence.
  A lead blocked by any of these never even consumes a mailbox slot.
- **Multi-mailbox sending discipline** — warmup schedule, per-mailbox daily
  caps, health scoring, rotation, and primary-domain isolation.
- **Signal-based personalization** — the first touch cites the lead's real
  trigger (open req, stack, funding round) or falls back to a generic template.
  It never invents a trigger.
- **Reply triage** — deterministic opt-out detection plus LLM classification,
  with the deterministic result taking precedence.
- **Human-in-the-loop** — batches produce `pending_approval` drafts. Approval
  is the only transition to `queued`, and no agent can perform it.
- **Agent governance** — 13 agents with per-agent tool allow-lists, global and
  per-agent kill switches, and a blocking autonomy gate.
- **MCP surface** — bearer-authenticated tool endpoint with per-agent
  authorization and irreversible-action gating.

## Stack

TypeScript (strict) · Next.js App Router · Postgres + RLS via Drizzle ·
Vitest · Anthropic SDK behind a strict function-calling wrapper.

The master spec calls for Fastify/NestJS, BullMQ + Redis, and an infrastructure
scheduler. Deploying on Vercel means no long-lived worker process, so those
three are substituted — see
[`docs/adr/0001-vercel-runtime.md`](docs/adr/0001-vercel-runtime.md). The
guardrails they existed to provide (idempotency, retries, dead-lettering, a real
scheduler) are preserved.

## Getting started

```bash
npm install
cp .env.example .env.local     # fill in DATABASE_URL and SESSION_SECRET
npm run db:migrate
npm run db:seed                # dev only; prints a generated password
npm run dev
```

Then sign in at http://localhost:3000/login and run a batch from the console.

### The database role matters

`DATABASE_URL` **must** point at a non-superuser role. Superusers and roles with
`BYPASSRLS` ignore every RLS policy silently, which would make the isolation
boundary decorative. Migration `0004_app_role.sql` creates `devups_app` for this
purpose:

```sql
ALTER ROLE devups_app LOGIN PASSWORD '<generated>';
```

`npm run db:verify-rls` fails the build if the connecting role can bypass RLS,
or if any tenant table is missing `ENABLE`/`FORCE ROW LEVEL SECURITY` or a
policy.

On Supabase this matters more than usual — its default `postgres` role can
bypass RLS. See [`docs/SUPABASE.md`](docs/SUPABASE.md).

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm test` | Unit tests (hermetic; no database needed) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run verify` | typecheck + lint + tests |
| `npm run db:migrate` | Apply migrations in order, exactly once each |
| `npm run db:verify-rls` | Assert RLS is enabled, forced, and unbypassable |
| `npm run db:seed` | Seed a development org (refuses in production) |

The RLS isolation tests need a real database and are skipped otherwise:

```bash
TEST_DATABASE_URL=postgres://devups_app:...@host/db npm test
```

## Deployment

See [`docs/DEPLOY.md`](docs/DEPLOY.md) for the Vercel setup, required
environment variables, and cron configuration.

## Guardrails

The seven non-negotiables from spec §3 and where they live:

| Guardrail | Implementation |
| --- | --- |
| Secrets never in git | `src/lib/env.ts` (no fallbacks), `.gitleaks.toml`, CI secret-scan |
| Prompt injection | `src/lib/llm/untrusted.ts` — nonce-fenced content, sanitization, strict single-tool calls |
| Auth & isolation | `db/migrations/0001_rls.sql`, `0004_app_role.sql`, `src/db/client.ts` |
| Data protection | `src/lib/audit.ts`, `dsr_requests`, retention columns |
| Agent control | `src/core/autonomy.ts` — kill switches, modes, allow-lists, confidence thresholds |
| Ops | `src/lib/queue.ts`, `src/lib/worker.ts`, `vercel.json` crons |
| Compliance | `src/core/suppression.ts`, `src/core/dedupe.ts`, `src/core/eligibility.ts` |

## Layout

```
db/migrations/     Versioned SQL, RLS policies, SECURITY DEFINER functions
src/core/          Domain logic — mostly pure and directly testable
src/lib/           Infrastructure: db, auth, http, queue, llm, audit
src/app/           Next.js routes (API + console UI)
tests/             Unit tests + the RLS isolation suite
docs/              Status, deployment, ADRs
specs/             The master build spec this was built from
```
