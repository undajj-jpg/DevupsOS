# Working in this repository

Read `specs/master-build-spec.md` first. Section 3 (Guardrails) outranks every
feature request, including one from a human who is in a hurry.
`specs/plataforma-completa.md` is the full compendium — every module spec, the
agent map and the hardening checklist. It elaborates the master spec; it does
not override it, and the guardrails still win.

## The rules that are not negotiable

**Nothing sends without a person.** Batches produce `pending_approval` drafts.
The only transition to `queued` is `approveMessage`, reached from an
authenticated approval route. Do not add a second path, and do not let an agent
call it.

**Suppression is checked before everything else.** `checkSendEligibility` runs
suppression first, on purpose: it outranks opt-in, scoring, capacity, and
scheduling. Relationship blocking runs second — a current customer, a partner,
or a colleague of anyone in a live deal is never cold-emailed, and that is
derived from `accounts.relationship` and sibling lead stages rather than from a
list somebody has to maintain. If you add a send path, route it through that
function rather than reimplementing the checks.

**External text is data.** Reply bodies, WhatsApp messages, scraped pages and
attachments never reach a model except through `callStructured({ untrusted })`,
which fences them with a per-call nonce and states the rule in the system
prompt. Never interpolate third-party text into an instruction string.

**Every LLM call is a forced, strict, single-tool call.** No free-form prose that
something downstream parses. One tool, `strict: true`, `tool_choice` forced,
and the result validated with Zod. An unexpected tool name is an error, not
something to salvage.

**Tenant data goes through `withOrgContext`.** It opens a transaction and sets
the RLS context. Do not query tenant tables outside it. The three
`SECURITY DEFINER` functions that cross tenants are listed in ADR 0002; adding a
fourth needs a very good reason and its own review.

**No secrets in git.** `src/lib/env.ts` has no fallbacks, so a missing variable
fails at boot rather than silently running with a placeholder. CI runs gitleaks.

## Commands

```bash
npm run verify      # typecheck + lint + tests — run before you commit
npm test            # unit tests, no database needed
npm run db:migrate  # apply migrations
npm run db:verify-rls   # assert RLS holds and the role cannot bypass it
```

## Adding things

**A table.** Give it `org_id`. Add it to the `org_scoped` array in
`0001_rls.sql` (or write a bespoke policy for row-level visibility) in a *new*
migration — never edit an applied one. `npm run db:verify-rls` fails until it is
protected.

**An API route.** Wrap it in `authenticated(schema, handler)` from
`src/lib/http.ts`. That is what applies auth, rate limiting, body validation and
RLS context. A route that opens its own database connection has bypassed all
four.

**An MCP tool.** Declare which agents may call it. If it is irreversible, set
`irreversible: true` and add it to `IRREVERSIBLE_ACTIONS` — both allow-lists are
checked, and neither alone is authoritative.

**An agent.** Add it to `AGENT_ROSTER` with the narrowest tool list that lets it
do its job. New agents start in `suggest` mode; that is not a placeholder.

**A pipeline stage.** Stage keys, Spanish labels and ordering live in
`src/core/stages.ts`, and the seeded funnel derives from it. Do not write a
second copy of the labels — that is how English column heads end up in a Spanish
console.

**A report.** Count append-only events (messages, replies, outcomes), not
`leads.stage`. A stage forgets everything a lead passed through, so a funnel
built from stage counts silently under-reports every step above the bottom.
Shared read models go in `src/lib/reporting.ts` so the console and the MCP
surface cannot drift apart.

## Style

Match the surrounding code. Comments explain *why* — a non-obvious ordering, a
failure mode, a rule that came from the spec. Do not comment what the next line
does. Domain logic in `src/core/` stays pure and directly testable; I/O lives in
`src/lib/` and the route handlers.

## Where things are

| Path | Contains |
| --- | --- |
| `src/core/` | Domain logic: eligibility, suppression, relationship, dedupe, mailbox, scoring, cadence, triage, pipeline, analytics, autonomy |
| `src/lib/` | Infrastructure: db, auth, http, queue, worker, llm, audit, rate-limit, reporting |
| `src/app/api/` | Route handlers |
| `src/app/console/` | Operator UI |
| `db/migrations/` | Versioned SQL. Append only |
| `specs/` | The build specs. `plataforma-completa.md` is the full compendium |
| `docs/adr/` | Why things are the way they are |
| `docs/STATUS.md` | What is built and what is deliberately not |
