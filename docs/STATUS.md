# Build status against the master spec

The spec (§8) prescribes an order and says explicitly: build the núcleo first
and validate the economics before adding layers. This is where that stands.

## Fase 0 — Fundamento: complete

| Item | Status |
| --- | --- |
| Repo, stack, strict TypeScript | Done |
| Secrets from a manager, none in git | Done — `src/lib/env.ts`, `.gitleaks.toml`, CI scan |
| CI: tests, lint, typecheck, secret-scan | Done — `.github/workflows/ci.yml` |
| Postgres + RLS, versioned migrations | Done — `db/migrations/`, verified in CI |
| Auth | Done — scrypt + signed session cookies, rate-limited |
| Scheduler | Done — Vercel Cron (see ADR 0001) |
| Queues | Done — Postgres-backed, `SKIP LOCKED`, retries, dead-letter |
| Observability | **Partial** — audit log and agent traces are in; OpenTelemetry and Sentry are not wired |

## Fase 1 — Núcleo: complete except the two live integrations

| Item | Status |
| --- | --- |
| Leads + import | Done — `POST /api/leads`, dedupes by (org, email) |
| Dedup / anti-resend / suppression | Done — blocking, ordered, tested |
| Multi-mailbox with warmup, caps, rotation, health | Done — `src/core/mailbox.ts` |
| Signal-based personalization | Done — `src/core/personalization.ts`, generic fallback |
| Basic pipeline | Done — funnels, stages, console views |
| Reply triage | Done — `src/core/triage.ts`, deterministic opt-out wins |
| Drafts with human approval | Done — `pending_approval` → `queued` only via a person |
| A/B variant assignment | Done — stable per lead |
| **Gmail send** | **Not implemented** — see below |
| **Gmail mailbox scan** | **Not implemented** — see below |
| Sourcing connectors (Gojiberry / Apollo / TheirStack) | **Not implemented** — import API accepts their output |
| Anymail Finder verification | **Not implemented** — `email_verified` is set by the importer |
| Cost-per-meeting measurement | **Not implemented** — `outcomes` table exists; no reporting yet |

### Why Gmail delivery is deliberately absent

The autonomy gate (§10) is blocking: *"ningún agente envía/actúa solo"* until
every guardrail is in place. Wiring a live send path before that gate passes
would make the gate cosmetic — the code would exist, and only a database flag
would stand between an unreviewed model output and a real prospect's inbox.

So the pipeline stops at `queued`. The `send_message` job handler is present and
exercised by the queue, and it refuses in three layers: no transport configured,
the global kill switch, and the unpassed gate. Wiring Gmail is the first task of
the next phase, and it should land together with OAuth token encryption (KMS),
delivery webhooks feeding `computeHealth`, and a `/security-review` pass.

The same reasoning applies to mailbox scanning: it needs the same OAuth
credentials, and the anti-resend registry is currently fed at approval time
rather than by a continuous inbox sweep. That is correct but narrower — it
covers engine sends, not messages a rep wrote by hand.

## Fases 2–4: not started

Conversion (voice-matched copywriter, calendar/scheduling, talent MCP client,
analytics), Intelligence (pgvector memory, entity resolution, Jarvis, skills
registry), and Autonomy are untouched. Per §8 they come after the núcleo's
economics are measured, and there is nothing to measure yet.

## Autonomy gate checklist (§10)

| Requirement | State |
| --- | --- |
| Secrets in a manager, tokens encrypted | Env/secrets manager: yes. KMS token encryption: not needed yet — no OAuth tokens are stored |
| Prompt-injection defense | Yes — nonce fencing, sanitization, strict single-tool calls, deterministic opt-out |
| Real auth + RLS | Yes — verified in CI, including that the app role cannot bypass RLS |
| Human-in-the-loop on irreversible actions | Yes — approval-only transition, `IRREVERSIBLE_ACTIONS` |
| Kill switch, global and per-agent | Yes |
| Real scheduler + idempotency | Yes — Vercel Cron, unique dedupe keys, unique job keys |
| Blocking suppression | Yes |

The gate is **not** marked passed in the database. Two of those rows only become
meaningful once a live send path exists, and flipping `autonomy_gate_passed`
is a deliberate, audited decision for a human — not something a build should do
on its own.
