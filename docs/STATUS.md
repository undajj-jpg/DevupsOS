# Build status against the spec

Two documents are in play. `specs/master-build-spec.md` is the original prompt
this repo was built from. `specs/plataforma-completa.md` is the full compendium
— the same master spec plus the per-module specs for every phase, the twelve-
agent map, and the hardening checklist. Where they differ, the compendium is
more detailed, not different in intent.

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
| Relationship suppression (customers, partners, live deals) | Done — `src/core/relationship.ts`, checked second in `checkSendEligibility` |
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
| Cost-per-meeting measurement | Done for model spend — `/console/analytics`. Sourcing and enrichment spend is not observable because those integrations do not exist yet, and the page says so |

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

## Fase 2 — Conversión: started

| Item | Status |
| --- | --- |
| Pipeline board / kanban / multiple funnels | Done — `/console/pipeline`, MCP `list_funnels` / `get_board` / `move_lead` |
| Analytics + A/B testing | Done — `/console/analytics`, MCP `get_analytics` |
| Voice-matched copywriter (`voice_profiles`, edit-diff learning) | Not implemented |
| Calendar / scheduling (Google, Outlook, Meet) | Not implemented |
| Talent MCP client, matching, shortlists | Not implemented |

The two that are done are the two that need no third-party credentials, and
§8 puts measurement first: the conversion funnel is the instrument the phase
gate is supposed to read. The other three each wait on an OAuth grant or on the
talent system's MCP server, and building them blind would mean guessing at
someone else's tool names.

### Why the board is not a full drag-and-drop CRM

Cards move between columns, and every move is audited and writes an outcome
event. What is deliberately absent: transition automations that fire on a move
(the spec's "mover a Reunión crea un hold en calendario"), because there is no
calendar integration to hold anything in, and configurable funnel editing,
because a funnel whose stages can be renamed at will needs a migration story for
the leads sitting in the old stages.

## Fases 3–4: not started

Intelligence (pgvector memory, entity resolution, contact 360, briefing hub,
document hub, topic auto-labelling, Jarvis, skills registry) and Autonomy are
untouched. Per §8 they come after the núcleo's economics are measured, and the
instrument to measure them only just landed.

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
