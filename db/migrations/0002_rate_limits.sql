-- Rate limiting (spec §3.3).
--
-- Deliberately in Postgres rather than in process memory: on serverless every
-- request may land on a fresh instance, so an in-memory bucket would reset
-- constantly and enforce nothing. A fixed window keyed by (bucket, window)
-- with an atomic upsert is shared across all instances.
--
-- This table is NOT org-scoped and carries no tenant data — it is keyed by
-- opaque identifiers (hashed token, IP) that exist before a tenant context
-- does, which is precisely when login and MCP auth need throttling.

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket text NOT NULL,
  window_start timestamptz NOT NULL,
  hits integer NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);

CREATE INDEX IF NOT EXISTS rate_limits_window_idx ON rate_limits (window_start);

CREATE OR REPLACE FUNCTION app.rate_limit_hit(
  p_bucket text,
  p_window_seconds integer,
  p_limit integer
) RETURNS TABLE (allowed boolean, hits integer, resets_at timestamptz)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
DECLARE
  v_window timestamptz;
  v_hits integer;
BEGIN
  v_window := to_timestamp(
    floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds
  );

  INSERT INTO rate_limits (bucket, window_start, hits)
  VALUES (p_bucket, v_window, 1)
  ON CONFLICT (bucket, window_start)
    DO UPDATE SET hits = rate_limits.hits + 1
  RETURNING rate_limits.hits INTO v_hits;

  RETURN QUERY
    SELECT v_hits <= p_limit, v_hits, v_window + make_interval(secs => p_window_seconds);
END $$;

REVOKE ALL ON FUNCTION app.rate_limit_hit(text, integer, integer) FROM PUBLIC;
