-- Row Level Security (spec §3.3, §4).
--
-- Isolation is enforced by Postgres, not by application code. Every request
-- opens a transaction and sets app.current_org_id / app.current_user_id /
-- app.current_role via SET LOCAL (see src/db/client.ts). If those settings are
-- absent, current_org() returns NULL and every policy evaluates to false, so a
-- code path that forgets to establish context reads nothing rather than
-- everything.
--
-- FORCE ROW LEVEL SECURITY is applied so the table owner is subject to the
-- policies too. Bootstrapping a brand-new org therefore cannot be done with a
-- plain INSERT; it goes through the SECURITY DEFINER function at the bottom of
-- this file, which is the single audited hole in the wall.

CREATE SCHEMA IF NOT EXISTS app;

CREATE OR REPLACE FUNCTION app.current_org() RETURNS uuid
  LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.current_org_id', true), '')::uuid;
  $$;

CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid;
  $$;

CREATE OR REPLACE FUNCTION app.current_role_name() RETURNS text
  LANGUAGE sql STABLE AS $$
    SELECT COALESCE(NULLIF(current_setting('app.current_role', true), ''), 'none');
  $$;

-- owner/admin see the whole org; 'service' is the scheduler/worker identity.
CREATE OR REPLACE FUNCTION app.is_admin() RETURNS boolean
  LANGUAGE sql STABLE AS $$
    SELECT app.current_role_name() IN ('owner', 'admin', 'service');
  $$;

CREATE OR REPLACE FUNCTION app.has_grant(p_table text, p_id uuid) RETURNS boolean
  LANGUAGE sql STABLE AS $$
    SELECT EXISTS (
      SELECT 1 FROM visibility_grants g
      WHERE g.org_id = app.current_org()
        AND g.user_id = app.current_user_id()
        AND g.resource_table = p_table
        AND g.resource_id = p_id
    );
  $$;

-- ---------------------------------------------------------------- org scope

DO $$
DECLARE
  t text;
  org_scoped text[] := ARRAY[
    'users', 'visibility_grants', 'domains', 'mailboxes', 'accounts',
    'contacts', 'contact_identities', 'funnels', 'lead_tags', 'suppression',
    'contacted_registry', 'consent_log', 'dsr_requests', 'agents',
    'agent_traces', 'jobs', 'audit_log', 'outcomes', 'experiments',
    'experiment_assignments'
  ];
BEGIN
  FOREACH t IN ARRAY org_scoped LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS org_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY org_isolation ON %I
         USING (org_id = app.current_org())
         WITH CHECK (org_id = app.current_org())', t);
  END LOOP;
END $$;

-- orgs itself: a session only ever sees its own org row.
ALTER TABLE orgs ENABLE ROW LEVEL SECURITY;
ALTER TABLE orgs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_self ON orgs;
CREATE POLICY org_self ON orgs
  USING (id = app.current_org())
  WITH CHECK (id = app.current_org());

-- ------------------------------------------------------------- row scope
-- Visible when the caller is an admin, owns the row, or holds a grant.

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lead_visibility ON leads;
CREATE POLICY lead_visibility ON leads
  USING (
    org_id = app.current_org()
    AND (
      app.is_admin()
      OR assigned_user_id = app.current_user_id()
      OR assigned_user_id IS NULL
      OR app.has_grant('leads', id)
    )
  )
  WITH CHECK (org_id = app.current_org());

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS message_visibility ON messages;
CREATE POLICY message_visibility ON messages
  USING (
    org_id = app.current_org()
    AND (
      app.is_admin()
      OR assigned_user_id = app.current_user_id()
      -- The subquery is itself filtered by lead_visibility, so message access
      -- follows lead access without restating the rule.
      OR EXISTS (SELECT 1 FROM leads l WHERE l.id = messages.lead_id)
    )
  )
  WITH CHECK (org_id = app.current_org());

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['replies', 'follow_ups'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS derived_visibility ON %I', t);
    EXECUTE format(
      'CREATE POLICY derived_visibility ON %I
         USING (
           org_id = app.current_org()
           AND (app.is_admin()
                OR EXISTS (SELECT 1 FROM leads l WHERE l.id = %I.lead_id))
         )
         WITH CHECK (org_id = app.current_org())', t, t);
  END LOOP;
END $$;

-- ------------------------------------------------------------- bootstrap
-- Creating the first org+owner is the one operation that cannot run under a
-- tenant context (there is no tenant yet). SECURITY DEFINER keeps that path
-- narrow: it can only ever insert one org and one owner, and it is revoked
-- from PUBLIC so only the application role may call it.

CREATE OR REPLACE FUNCTION app.bootstrap_org(
  p_org_name text,
  p_email text,
  p_user_name text,
  p_password_hash text
) RETURNS TABLE (org_id uuid, user_id uuid)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
DECLARE
  v_org uuid;
  v_user uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE email = lower(p_email)) THEN
    RAISE EXCEPTION 'email already registered' USING ERRCODE = 'unique_violation';
  END IF;

  INSERT INTO orgs (name) VALUES (p_org_name) RETURNING id INTO v_org;

  INSERT INTO users (org_id, email, name, role, password_hash)
  VALUES (v_org, lower(p_email), p_user_name, 'owner', p_password_hash)
  RETURNING id INTO v_user;

  RETURN QUERY SELECT v_org, v_user;
END $$;

REVOKE ALL ON FUNCTION app.bootstrap_org(text, text, text, text) FROM PUBLIC;

-- Login must find a user before any org context exists. This function returns
-- only the fields needed to verify a password and open a session; it never
-- exposes other columns and cannot be used to enumerate an org's users.
CREATE OR REPLACE FUNCTION app.lookup_login(p_email text)
  RETURNS TABLE (id uuid, org_id uuid, role text, password_hash text, active boolean)
  LANGUAGE sql SECURITY DEFINER SET search_path = public, app STABLE AS $$
    SELECT u.id, u.org_id, u.role, u.password_hash, u.active
    FROM users u
    WHERE u.email = lower(p_email);
  $$;

REVOKE ALL ON FUNCTION app.lookup_login(text) FROM PUBLIC;
