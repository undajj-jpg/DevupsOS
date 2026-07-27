# Using Supabase as the database

Supabase is plain Postgres, so everything here works unchanged. Three details
matter, and the second one is a trap that would silently disable tenant
isolation.

## 1. Use the pooled connection string, transaction mode

Supabase → Project Settings → Database → Connection string.

| Use | Port | Why |
| --- | --- | --- |
| **App** (`DATABASE_URL` on Vercel) | **6543** (Supavisor, transaction mode) | Serverless opens and drops connections constantly; the direct endpoint runs out. Transaction mode is also IPv4-reachable, which the direct endpoint may not be. |
| **Migrations** (from your machine or CI) | 5432 (session mode or direct) | `CREATE ROLE` and `ALTER DEFAULT PRIVILEGES` want a stable session. |

```
# app — note port 6543
postgresql://devups_app:<pw>@aws-0-<region>.pooler.supabase.com:6543/postgres?sslmode=require

# migrations — note port 5432 and the owner role
postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require
```

Transaction pooling is safe for the RLS context. `withOrgContext` issues
`SET LOCAL` **inside** an explicit transaction, and transaction mode pins one
server connection for the life of a transaction — so the setting cannot leak to
another tenant's request. `prepare: false` is already set in
`src/db/client.ts`, which is the other requirement for transaction pooling.

## 2. Do not point `DATABASE_URL` at Supabase's `postgres` role

This is the important one. On Supabase the `postgres` role is not a superuser,
but it is a **member of roles that can bypass RLS**, and it owns the tables. A
role that can bypass RLS reads every tenant's rows no matter what the policies
say, and does so silently — no error, no warning, just cross-tenant data.

So: run migrations as `postgres`, then have the app connect as `devups_app`,
which `0004_app_role.sql` creates as `NOSUPERUSER NOBYPASSRLS`.

```bash
# 1. migrate as the owner (port 5432)
export DATABASE_URL='postgresql://postgres.<ref>:<pw>@...pooler.supabase.com:5432/postgres?sslmode=require'
npm run db:migrate

# 2. give the app role a password
psql "$DATABASE_URL" -c "ALTER ROLE devups_app LOGIN PASSWORD '<generate one>';"

# 3. prove the app role cannot bypass RLS (port 6543)
DATABASE_URL='postgresql://devups_app:<pw>@...pooler.supabase.com:6543/postgres?sslmode=require' \
  npm run db:verify-rls
# → RLS verified on 25 tenant tables
```

If step 3 prints `connected as "postgres", which has BYPASSRLS`, you are using
the wrong role. That check exists because this exact mistake is invisible at
runtime — the app works perfectly while isolation is off.

## 3. Supabase's auto-generated REST API is a second door

Supabase exposes every table in `public` over PostgREST. That is a second path
into the same rows that does not go through this application's auth.

It happens to be safe here, by construction rather than by luck: PostgREST
connects as `anon` or `authenticated`, neither of which sets
`app.current_org_id`, so `app.current_org()` returns NULL, every policy
evaluates false, and those roles read **zero rows**. The fail-closed default is
doing its job.

Two things to keep true:

- **Never put the `service_role` key anywhere near this app or its clients.**
  `service_role` bypasses RLS entirely. This application does not use the
  Supabase client libraries at all, so it never needs that key.
- If you want the door shut rather than merely locked, revoke table access from
  the API roles. Nothing in this app uses them:

  ```sql
  REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
  ```

## What Supabase features this project does not use

- **Supabase Auth** — sessions are scrypt + a signed cookie
  (`src/lib/auth/`). Adding Supabase Auth would mean two identity systems
  disagreeing about who the caller is.
- **Supabase client libraries** — the app talks to Postgres over the wire with
  `postgres.js` + Drizzle.
- **Row Level Security via `auth.uid()`** — policies read
  `app.current_org_id`, set per transaction by the application. `auth.uid()`
  only means something inside a Supabase Auth session.

`pgvector` is available on Supabase and will be needed for Fase 3 (unified
memory). Nothing today requires it.
