-- NUMINA least-privilege migration verification.
-- Read-only assertions for a temporary Neon test branch after applying
-- 0002_security_least_privilege.sql. This file does not change privileges or data.

DO $$
BEGIN
  IF pg_has_role('numina_runtime', 'neon_superuser', 'member') THEN
    RAISE EXCEPTION 'numina_runtime still inherits neon_superuser';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'numina_runtime'
      AND (rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'numina_runtime still has elevated role attributes';
  END IF;

  IF NOT has_database_privilege('numina_runtime', current_database(), 'CONNECT') THEN
    RAISE EXCEPTION 'numina_runtime lost database CONNECT';
  END IF;

  IF NOT has_schema_privilege('numina_runtime', 'public', 'USAGE')
     OR has_schema_privilege('numina_runtime', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'public schema privileges do not match least-privilege policy';
  END IF;

  IF NOT has_schema_privilege('numina_runtime', 'public_evidence', 'USAGE') THEN
    RAISE EXCEPTION 'numina_runtime lost public_evidence USAGE';
  END IF;

  IF NOT (
    has_table_privilege('numina_runtime', 'public.numina_evidence_records', 'SELECT')
    AND has_table_privilege('numina_runtime', 'public.numina_evidence_records', 'INSERT')
    AND has_table_privilege('numina_runtime', 'public.numina_evidence_records', 'UPDATE')
    AND NOT has_table_privilege('numina_runtime', 'public.numina_evidence_records', 'DELETE')
  ) THEN
    RAISE EXCEPTION 'numina_evidence_records privileges are incorrect';
  END IF;

  IF NOT (
    has_table_privilege('numina_runtime', 'public.numina_verification_jobs', 'SELECT')
    AND has_table_privilege('numina_runtime', 'public.numina_verification_jobs', 'INSERT')
    AND has_table_privilege('numina_runtime', 'public.numina_verification_jobs', 'UPDATE')
    AND NOT has_table_privilege('numina_runtime', 'public.numina_verification_jobs', 'DELETE')
  ) THEN
    RAISE EXCEPTION 'numina_verification_jobs privileges are incorrect';
  END IF;

  IF NOT (
    has_table_privilege('numina_runtime', 'public_evidence.latest_provider_observation', 'SELECT')
    AND NOT has_table_privilege('numina_runtime', 'public_evidence.latest_provider_observation', 'INSERT')
    AND NOT has_table_privilege('numina_runtime', 'public_evidence.latest_provider_observation', 'UPDATE')
    AND NOT has_table_privilege('numina_runtime', 'public_evidence.latest_provider_observation', 'DELETE')
  ) THEN
    RAISE EXCEPTION 'latest_provider_observation privileges are incorrect';
  END IF;

  IF NOT (
    has_table_privilege('numina_runtime', 'public_evidence.provider_observation_history', 'SELECT')
    AND NOT has_table_privilege('numina_runtime', 'public_evidence.provider_observation_history', 'INSERT')
    AND NOT has_table_privilege('numina_runtime', 'public_evidence.provider_observation_history', 'UPDATE')
    AND NOT has_table_privilege('numina_runtime', 'public_evidence.provider_observation_history', 'DELETE')
  ) THEN
    RAISE EXCEPTION 'provider_observation_history privileges are incorrect';
  END IF;

  IF has_function_privilege('numina_runtime', 'public.show_db_tree()', 'EXECUTE') THEN
    RAISE EXCEPTION 'numina_runtime can still execute show_db_tree()';
  END IF;

  IF has_function_privilege('public', 'public.show_db_tree()', 'EXECUTE') THEN
    RAISE EXCEPTION 'PUBLIC can still execute show_db_tree()';
  END IF;

  IF NOT has_function_privilege('numina_owner', 'public.show_db_tree()', 'EXECUTE') THEN
    RAISE EXCEPTION 'numina_owner lost show_db_tree() execution';
  END IF;
END
$$;

SELECT jsonb_build_object(
  'schema', 'numina.neon.least-privilege-verification.v1',
  'runtime_role', 'numina_runtime',
  'inherits_neon_superuser', pg_has_role('numina_runtime', 'neon_superuser', 'member'),
  'evidence_table_write', true,
  'verification_jobs_write', true,
  'public_evidence_read_only', true,
  'show_db_tree_public_execute', has_function_privilege('public', 'public.show_db_tree()', 'EXECUTE'),
  'verified', true
) AS verification;
