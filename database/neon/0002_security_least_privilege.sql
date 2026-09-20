-- NUMINA production database least-privilege hardening.
-- Prepared from the 2026-09-20 security audit.
-- REVIEW REQUIRED before applying to production.
--
-- Current finding:
--   numina_runtime inherits neon_superuser and therefore has CREATEROLE,
--   CREATEDB, REPLICATION, BYPASSRLS and full table access.
-- Intended runtime operations observed in source require SELECT/INSERT/UPDATE
-- on the evidence and verification-job tables, plus read-only evidence views.

REVOKE neon_superuser FROM numina_runtime;
ALTER ROLE numina_runtime NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS;

REVOKE ALL PRIVILEGES ON DATABASE numina FROM numina_runtime;
GRANT CONNECT ON DATABASE numina TO numina_runtime;

REVOKE ALL PRIVILEGES ON SCHEMA public FROM numina_runtime;
GRANT USAGE ON SCHEMA public TO numina_runtime;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM numina_runtime;
GRANT SELECT, INSERT, UPDATE
  ON TABLE public.numina_evidence_records, public.numina_verification_jobs
  TO numina_runtime;

REVOKE ALL PRIVILEGES ON SCHEMA public_evidence FROM numina_runtime;
GRANT USAGE ON SCHEMA public_evidence TO numina_runtime;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public_evidence FROM numina_runtime;
GRANT SELECT
  ON TABLE public_evidence.latest_provider_observation,
           public_evidence.provider_observation_history
  TO numina_runtime;

-- show_db_tree exposes database/schema object names and currently inherits
-- PostgreSQL's default PUBLIC EXECUTE privilege.
REVOKE EXECUTE ON FUNCTION public.show_db_tree() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.show_db_tree() TO numina_owner;
