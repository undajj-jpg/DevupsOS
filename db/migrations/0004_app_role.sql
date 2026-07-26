-- The application database role (spec §3.3).
--
-- RLS is not a property of the policies alone — it is a property of the role
-- that connects. A superuser bypasses every policy silently, and so does any
-- role with BYPASSRLS. FORCE ROW LEVEL SECURITY closes the *table owner* hole,
-- but nothing in SQL closes the superuser hole.
--
-- So the application gets its own role: `devups_app`, NOSUPERUSER, NOBYPASSRLS,
-- with DML rights on the tenant tables and EXECUTE on the narrow set of
-- SECURITY DEFINER functions it legitimately needs. DATABASE_URL must point at
-- this role. scripts/verify-rls.ts fails the build if it doesn't.
--
-- Role creation is cluster-level and some managed providers restrict it; the
-- DO block below degrades to a notice rather than failing the migration, and
-- the verification script is what actually enforces the requirement.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'devups_app') THEN
    BEGIN
      CREATE ROLE devups_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'could not create devups_app; create it manually and re-run';
      RETURN;
    END;
  ELSE
    -- Defensive: an operator may have granted these later.
    ALTER ROLE devups_app NOSUPERUSER NOBYPASSRLS;
  END IF;

  EXECUTE 'GRANT USAGE ON SCHEMA public, app TO devups_app';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO devups_app';
  EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO devups_app';

  -- Future tables created by later migrations inherit the same grants, so
  -- adding a table cannot accidentally leave the app unable to read it.
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public
             GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO devups_app';
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public
             GRANT USAGE, SELECT ON SEQUENCES TO devups_app';

  -- The migration bookkeeping table is not the application's business.
  EXECUTE 'REVOKE ALL ON TABLE _migrations FROM devups_app';

  -- Exactly the SECURITY DEFINER functions the app needs, and no others.
  EXECUTE 'GRANT EXECUTE ON FUNCTION app.bootstrap_org(text, text, text, text) TO devups_app';
  EXECUTE 'GRANT EXECUTE ON FUNCTION app.lookup_login(text) TO devups_app';
  EXECUTE 'GRANT EXECUTE ON FUNCTION app.rate_limit_hit(text, integer, integer) TO devups_app';
  EXECUTE 'GRANT EXECUTE ON FUNCTION app.list_schedulable_orgs() TO devups_app';
  EXECUTE 'GRANT EXECUTE ON FUNCTION app.claim_jobs(text, integer) TO devups_app';
  EXECUTE 'GRANT EXECUTE ON FUNCTION app.reclaim_stale_jobs(integer) TO devups_app';
  EXECUTE 'GRANT EXECUTE ON FUNCTION app.prune_rate_limits(integer) TO devups_app';
END $$;
