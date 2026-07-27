# Deploying to Vercel

## 1. Provision Postgres

Any Postgres 14+ works. Neon, Supabase and Vercel Postgres are all fine —
`pgvector` is not needed until Fase 3.

Take the **pooled** connection string; serverless opens and drops connections
constantly and will exhaust a direct-connection limit.

**Using Supabase? Read [`SUPABASE.md`](SUPABASE.md) first.** Its `postgres` role
can bypass RLS, so pointing `DATABASE_URL` at it would silently disable tenant
isolation while the app appears to work perfectly.

## 2. Run migrations, then create the application role

Migrations run as the database **owner**. The application must not.

```bash
export DATABASE_URL='postgres://<owner>:<pw>@<host>/<db>?sslmode=require'
npm run db:migrate
```

Migration `0004_app_role.sql` creates `devups_app` as `NOSUPERUSER NOBYPASSRLS`.
Give it a password:

```bash
psql "$DATABASE_URL" -c "ALTER ROLE devups_app LOGIN PASSWORD '<generate one>';"
```

Verify before going further — this is the check that catches a misconfigured
role, and a superuser `DATABASE_URL` would silently disable tenant isolation:

```bash
DATABASE_URL='postgres://devups_app:<pw>@<host>/<db>?sslmode=require' \
  npm run db:verify-rls
# → RLS verified on N tenant tables
```

**The `DATABASE_URL` you give Vercel is the `devups_app` one**, not the owner's.

## 3. Environment variables

Set these in Vercel → Project → Settings → Environment Variables, for
Production and Preview.

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | The `devups_app` pooled connection string |
| `SESSION_SECRET` | yes | ≥ 32 chars. `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `CRON_SECRET` | yes | Bearer token for cron endpoints. Without it they refuse to run |
| `MCP_TOKEN` | no | Bearer token for the MCP surface. Omit to leave MCP disabled |
| `ANTHROPIC_API_KEY` | no | Without it, drafting uses templates and triage uses deterministic rules |
| `ANTHROPIC_MODEL` | no | Defaults to `claude-opus-5` |
| `APP_URL` | no | Your production URL |
| `FORCE_SUGGESTION_MODE` | no | Defaults to on. Set to exactly `false` only after the §10 gate passes |

Never set these in `vercel.json` or commit them — CI runs gitleaks and will
fail the build.

## 4. Deploy

Connect the GitHub repository in the Vercel dashboard (Add New → Project →
import `undajj-jpg/DevupsOS`). Framework detection picks up Next.js; no build
overrides are needed.

Or from the CLI:

```bash
npx vercel link
npx vercel --prod
```

## 5. Cron

Vercel registers the schedules in `vercel.json` on deploy and sends
`CRON_SECRET` as a bearer token on each invocation.

**The committed schedule is Hobby-compatible**, because Hobby allows at most
two cron jobs and each may run **at most once per day**. A `vercel.json` with a
sub-daily expression is *rejected at deploy time* — the deployment fails with
`cron_jobs_limits_reached`; it is not silently downgraded.

| Path | Schedule | Does |
| --- | --- | --- |
| `/api/cron/daily-batch` | 11:00 UTC, Mon–Fri | Prepares each org's drafts for review |
| `/api/cron/tick` | 12:00 UTC daily | Drains the job queue, reclaims stale jobs |

Daily draining is adequate today: no job in the queue is latency-sensitive
while delivery is unwired. It will not be adequate once mail is being sent.

### Restoring the real cadence

On **Pro**, replace the `crons` array with:

```json
[
  { "path": "/api/cron/tick",           "schedule": "*/5 * * * *" },
  { "path": "/api/cron/scan-mailboxes", "schedule": "0 * * * *" },
  { "path": "/api/cron/daily-batch",    "schedule": "0 11 * * 1-5" }
]
```

On **Hobby**, drive the endpoints from any external scheduler instead — GitHub
Actions, cron-job.org, a box you already run. They are plain authenticated HTTP
endpoints, so this preserves the §3.6 guardrail that the scheduler is real
infrastructure rather than an in-process timer:

```yaml
# .github/workflows/tick.yml
on:
  schedule: [{ cron: '*/5 * * * *' }]
jobs:
  tick:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -fsS -X GET "$APP_URL/api/cron/tick" \
            -H "Authorization: Bearer $CRON_SECRET"
        env:
          APP_URL: ${{ vars.APP_URL }}
          CRON_SECRET: ${{ secrets.CRON_SECRET }}
```

## 6. Verify the deployment

```bash
curl https://<your-app>/api/health
# → {"status":"ok"}

curl -o /dev/null -w '%{http_code}\n' https://<your-app>/api/cron/tick
# → 401   (no bearer token — correct)
```

Then create the first organization at `https://<your-app>/login`. The first
account is the owner; add teammates from there.

## Post-deploy checklist

- [ ] `db:verify-rls` passes against the production `DATABASE_URL`
- [ ] `/api/cron/tick` returns 401 without a bearer token
- [ ] The dashboard shows **Not passed — suggestion mode** for the autonomy gate
- [ ] No secrets in the repository (CI's gitleaks job is green)
- [ ] A test batch produces `pending_approval` drafts and sends nothing

## Before enabling real sending

Delivery is not wired, on purpose — see [`STATUS.md`](STATUS.md). Before that
changes:

1. Gmail OAuth with tokens encrypted at rest (KMS), minimum scopes, rotation.
2. Delivery and complaint webhooks feeding `computeHealth`.
3. Seed and placement tests on the secondary domains; DMARC monitoring.
4. Unsubscribe link and physical postal address in every template.
5. Legal review per target region.
6. `/security-review` over the send path.
7. Only then set `autonomy_gate_passed`, and even then leave irreversible
   actions human-gated.
