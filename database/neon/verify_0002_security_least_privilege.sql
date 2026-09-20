-- NUMINA least-privilege migration verification.
-- Read-only assertions for a temporary Neon branch after applying
-- 0002_security_least_privilege.sql.
--
-- This verifies the staged pre-cutover state. numina_app_runtime MUST remain
-- NOLOGIN until a separate secure credential-provisioning step is approved.

DO $$
DECLARE r pg_roles%ROWTYPE;
BEGIN
  SELECT * INTO r FROM pg_roles WHERE rolname='numina_app_runtime';

  IF r.rolname IS NULL THEN
    RAISE EXCEPTION 'numina_app_runtime does not exist';
  END IF;

  IF r.rolcanlogin THEN
    RAISE EXCEPTION 'numina_app_runtime LOGIN enabled before credential cutover';
  END IF;

  IF r.rolsuper OR r.rolinherit OR r.rolcreaterole OR r.rolcreatedb
     OR r.rolreplication OR r.rolbypassrls THEN
    RAISE EXCEPTION 'numina_app_runtime has elevated role attributes';
  END IF;

  IF pg_has_role('numina_app_runtime','neon_superuser','member') THEN
    RAISE EXCEPTION 'numina_app_runtime inherits neon_superuser';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_auth_members m
    JOIN pg_roles member_role ON member_role.oid=m.member
    WHERE member_role.rolname='numina_app_runtime'
  ) THEN
    RAISE EXCEPTION 'numina_app_runtime has unexpected role memberships';
  END IF;

  IF NOT has_database_privilege('numina_app_runtime', current_database(), 'CONNECT') THEN
    RAISE EXCEPTION 'numina_app_runtime lost database CONNECT';
  END IF;

  IF NOT has_schema_privilege('numina_app_runtime','public','USAGE')
     OR has_schema_privilege('numina_app_runtime','public','CREATE') THEN
    RAISE EXCEPTION 'public schema privileges do not match least-privilege policy';
  END IF;

  IF NOT has_schema_privilege('numina_app_runtime','public_evidence','USAGE') THEN
    RAISE EXCEPTION 'numina_app_runtime lost public_evidence USAGE';
  END IF;

  IF NOT (
    has_table_privilege('numina_app_runtime','public.numina_evidence_records','SELECT')
    AND has_table_privilege('numina_app_runtime','public.numina_evidence_records','INSERT')
    AND has_table_privilege('numina_app_runtime','public.numina_evidence_records','UPDATE')
    AND NOT has_table_privilege('numina_app_runtime','public.numina_evidence_records','DELETE')
  ) THEN
    RAISE EXCEPTION 'numina_evidence_records privileges are incorrect';
  END IF;

  IF NOT (
    has_table_privilege('numina_app_runtime','public.numina_verification_jobs','SELECT')
    AND has_table_privilege('numina_app_runtime','public.numina_verification_jobs','INSERT')
    AND has_table_privilege('numina_app_runtime','public.numina_verification_jobs','UPDATE')
    AND NOT has_table_privilege('numina_app_runtime','public.numina_verification_jobs','DELETE')
  ) THEN
    RAISE EXCEPTION 'numina_verification_jobs privileges are incorrect';
  END IF;

  IF NOT (
    has_table_privilege('numina_app_runtime','public_evidence.latest_provider_observation','SELECT')
    AND NOT has_table_privilege('numina_app_runtime','public_evidence.latest_provider_observation','INSERT')
    AND NOT has_table_privilege('numina_app_runtime','public_evidence.latest_provider_observation','UPDATE')
    AND NOT has_table_privilege('numina_app_runtime','public_evidence.latest_provider_observation','DELETE')
  ) THEN
    RAISE EXCEPTION 'latest_provider_observation privileges are incorrect';
  END IF;

  IF NOT (
    has_table_privilege('numina_app_runtime','public_evidence.provider_observation_history','SELECT')
    AND NOT has_table_privilege('numina_app_runtime','public_evidence.provider_observation_history','INSERT')
    AND NOT has_table_privilege('numina_app_runtime','public_evidence.provider_observation_history','UPDATE')
    AND NOT has_table_privilege('numina_app_runtime','public_evidence.provider_observation_history','DELETE')
  ) THEN
    RAISE EXCEPTION 'provider_observation_history privileges are incorrect';
  END IF;

  IF has_function_privilege('numina_app_runtime','public.show_db_tree()','EXECUTE') THEN
    RAISE EXCEPTION 'numina_app_runtime can execute show_db_tree()';
  END IF;

  IF has_function_privilege('public','public.show_db_tree()','EXECUTE') THEN
    RAISE EXCEPTION 'PUBLIC can still execute show_db_tree()';
  END IF;

  IF NOT has_function_privilege('numina_owner','public.show_db_tree()','EXECUTE') THEN
    RAISE EXCEPTION 'numina_owner lost show_db_tree() execution';
  END IF;
END
$$;

SELECT jsonb_build_object(
  'schema','numina.neon.least-privilege-verification.v2',
  'runtime_role','numina_app_runtime',
  'staged_no_login',NOT (SELECT rolcanlogin FROM pg_roles WHERE rolname='numina_app_runtime'),
  'inherits_neon_superuser',pg_has_role('numina_app_runtime','neon_superuser','member'),
  'evidence_table_write',true,
  'verification_jobs_write',true,
  'public_evidence_read_only',true,
  'show_db_tree_public_execute',has_function_privilege('public','public.show_db_tree()','EXECUTE'),
  'credential_cutover_required',true,
  'verified',true
) AS verification;
