-- NUMINA production database least-privilege hardening.
-- Prepared from the 2026-09-20 security audit and nonproduction validation.
-- REVIEW REQUIRED before production application.
--
-- Neon-managed roles created through the control plane inherit neon_superuser.
-- The existing numina_runtime membership was granted by cloud_admin and cannot
-- be revoked by numina_owner. This migration therefore stages a replacement
-- application role created directly in SQL, with no inherited memberships.
--
-- Credential cutover is deliberately separate:
--   1. apply this migration with numina_app_runtime kept NOLOGIN;
--   2. provision a strong password through a secure operator channel and enable LOGIN;
--   3. point NUMINA_EVIDENCE_DATABASE_URL / DATABASE_URL at numina_app_runtime;
--   4. verify application/evidence traffic;
--   5. only then decide whether the legacy numina_runtime login can be disabled.
--
-- No credential is embedded in this repository.

DO $$
DECLARE r pg_roles%ROWTYPE;
BEGIN
  SELECT * INTO r FROM pg_roles WHERE rolname='numina_app_runtime';

  IF r.rolname IS NULL THEN
    CREATE ROLE numina_app_runtime
      NOLOGIN
      NOSUPERUSER
      NOCREATEROLE
      NOCREATEDB
      NOREPLICATION
      NOBYPASSRLS
      NOINHERIT;
  ELSE
    IF r.rolcanlogin OR r.rolsuper OR r.rolinherit OR r.rolcreaterole
       OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls THEN
      RAISE EXCEPTION 'numina_app_runtime role attributes drifted from staged least-privilege policy';
    END IF;
    IF pg_has_role('numina_app_runtime','neon_superuser','member') THEN
      RAISE EXCEPTION 'numina_app_runtime unexpectedly inherits neon_superuser';
    END IF;
  END IF;
END
$$;

REVOKE ALL PRIVILEGES ON DATABASE numina FROM numina_app_runtime;
GRANT CONNECT ON DATABASE numina TO numina_app_runtime;

REVOKE ALL PRIVILEGES ON SCHEMA public FROM numina_app_runtime;
GRANT USAGE ON SCHEMA public TO numina_app_runtime;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM numina_app_runtime;
GRANT SELECT, INSERT, UPDATE
  ON TABLE public.numina_evidence_records, public.numina_verification_jobs
  TO numina_app_runtime;

REVOKE ALL PRIVILEGES ON SCHEMA public_evidence FROM numina_app_runtime;
GRANT USAGE ON SCHEMA public_evidence TO numina_app_runtime;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public_evidence FROM numina_app_runtime;
GRANT SELECT
  ON TABLE public_evidence.latest_provider_observation,
           public_evidence.provider_observation_history
  TO numina_app_runtime;

-- show_db_tree exposes database/schema object names and inherits PostgreSQL's
-- default PUBLIC EXECUTE privilege unless explicitly revoked.
REVOKE EXECUTE ON FUNCTION public.show_db_tree() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.show_db_tree() TO numina_owner;
