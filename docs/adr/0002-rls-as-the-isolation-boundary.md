# ADR 0002 — RLS is the isolation boundary, and the app role must not outrank it

**Status:** accepted
**Date:** 2026-07-26

## Context

Spec §3.3 names Postgres RLS as *the* source of tenant isolation, and §4 requires
`org_id` on every table with row visibility derived from role, assignment, or an
explicit grant.

The obvious implementation — add `WHERE org_id = $1` to every query — fails on
the first forgotten clause, and nothing catches it. That is a data breach one
missing predicate away, in a codebase where every feature adds queries.

## Decision

Three layers, each closing a hole the previous one leaves open.

**1. Policies, with context per transaction.** Every tenant table has RLS
enabled with a policy reading `app.current_org()`, which resolves from a
`SET LOCAL` inside the request transaction (`src/db/client.ts`). `SET LOCAL`
scopes the identity to the transaction, so a pooled connection handed to the
next request cannot inherit the previous tenant's.

The important property is the failure mode: with no context set,
`current_setting(..., true)` returns NULL, every policy evaluates false, and a
query returns **zero rows**. Forgetting to establish context denies rather than
exposes.

**2. `FORCE ROW LEVEL SECURITY`.** Plain `ENABLE` exempts the table owner — and
on most managed Postgres the application connects as the owner, so `ENABLE`
alone would leave RLS switched on and doing nothing. `FORCE` closes that.

**3. A dedicated `NOSUPERUSER NOBYPASSRLS` role.** `FORCE` does not stop a
superuser; nothing in SQL does. This was found the hard way — the first run of
the isolation tests passed cleanly while every policy was being bypassed,
because the test role was a superuser created by `initdb`. The tests reported
success on a system with no isolation at all.

So the app gets `devups_app` (`db/migrations/0004_app_role.sql`), and
`scripts/verify-rls.ts` fails the build if the connecting role is a superuser or
holds `BYPASSRLS`, if any tenant table lacks `ENABLE`/`FORCE`, or if a table has
RLS but no policy (which would deny everything and break silently in the other
direction).

## Two deliberate holes, both narrow

Some operations genuinely cannot run inside a tenant context:

- **Bootstrap and login** happen before a tenant is known. `app.bootstrap_org`
  and `app.lookup_login` are `SECURITY DEFINER`, revoked from `PUBLIC`, and
  return only what their single purpose needs — login returns five columns for
  password verification and cannot enumerate an org's users.
- **The scheduler** must list orgs and claim jobs across tenants before it can
  adopt any tenant's identity. Three functions cover exactly that, and every
  handler re-enters `withOrgContext` for the claimed job's own org before
  touching business data.

Each is a function with a fixed shape, not a general bypass.

## Consequences

- A new table is protected or the build fails. `scripts/verify-rls.ts` runs in
  CI against a real Postgres, so "forgot to enable RLS" is a red build rather
  than a silent leak.
- Isolation is proven, not asserted. `tests/rls.integration.test.ts` creates two
  orgs and checks cross-tenant reads, cross-tenant writes, member-level
  visibility, grants, and the no-context case.
- Policies cost a little on every query. Worth it.
- Deployment gains a required step: create `devups_app`, give it a password, and
  point `DATABASE_URL` at it. Documented in the README and enforced by
  `db:verify-rls`.
