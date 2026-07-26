-- Scheduler entry point (spec §3.6).
--
-- The cron handler has to enumerate tenants *before* it can adopt any tenant's
-- context, which RLS correctly forbids. Rather than granting the scheduler a
-- blanket bypass, this SECURITY DEFINER function exposes exactly one thing:
-- the (org, owner) pairs eligible for scheduled work. It returns no business
-- data, so a caller that reached it could learn which orgs exist and nothing
-- else — and it is revoked from PUBLIC.

CREATE OR REPLACE FUNCTION app.list_schedulable_orgs()
  RETURNS TABLE (org_id uuid, owner_id uuid)
  LANGUAGE sql SECURITY DEFINER SET search_path = public, app STABLE AS $$
    SELECT o.id, u.id
    FROM orgs o
    JOIN LATERAL (
      SELECT id FROM users
      WHERE org_id = o.id AND role = 'owner' AND active
      ORDER BY created_at
      LIMIT 1
    ) u ON true
    WHERE o.agents_enabled = true;
  $$;

REVOKE ALL ON FUNCTION app.list_schedulable_orgs() FROM PUBLIC;

-- Housekeeping: rate-limit windows are worthless once elapsed.
CREATE OR REPLACE FUNCTION app.prune_rate_limits(p_keep_hours integer DEFAULT 24)
  RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM rate_limits
  WHERE window_start < now() - make_interval(hours => p_keep_hours);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END $$;

REVOKE ALL ON FUNCTION app.prune_rate_limits(integer) FROM PUBLIC;

-- Job claiming has the same ordering problem as org enumeration: the worker
-- cannot adopt a tenant's RLS context until it knows which tenant the next job
-- belongs to. These two functions are the only way to reach across tenants,
-- they return job envelopes rather than business rows, and every handler that
-- acts on a claimed job re-enters through withOrgContext for that job's org.

CREATE OR REPLACE FUNCTION app.claim_jobs(p_worker_id text, p_limit integer)
  RETURNS TABLE (
    id uuid,
    org_id uuid,
    kind text,
    payload jsonb,
    attempts integer,
    max_attempts integer
  )
  LANGUAGE sql SECURITY DEFINER SET search_path = public, app AS $$
    UPDATE jobs SET
      status = 'running',
      locked_at = now(),
      locked_by = p_worker_id,
      attempts = jobs.attempts + 1
    WHERE jobs.id IN (
      SELECT j.id FROM jobs j
      WHERE j.status = 'pending' AND j.run_at <= now()
      ORDER BY j.run_at
      FOR UPDATE SKIP LOCKED
      LIMIT p_limit
    )
    RETURNING jobs.id, jobs.org_id, jobs.kind, jobs.payload,
              jobs.attempts, jobs.max_attempts;
  $$;

REVOKE ALL ON FUNCTION app.claim_jobs(text, integer) FROM PUBLIC;

-- Releases jobs whose worker died mid-run so they become claimable again.
CREATE OR REPLACE FUNCTION app.reclaim_stale_jobs(p_older_than_minutes integer)
  RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE jobs SET status = 'pending', locked_at = NULL, locked_by = NULL
  WHERE status = 'running'
    AND locked_at < now() - make_interval(mins => p_older_than_minutes);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION app.reclaim_stale_jobs(integer) FROM PUBLIC;
