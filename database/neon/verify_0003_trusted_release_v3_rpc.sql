-- Read-only verification for 0003_trusted_release_v3_rpc_least_privilege.sql.
DO $$
DECLARE
  r pg_roles%ROWTYPE;
BEGIN
  SELECT * INTO r FROM pg_roles WHERE rolname='numina_app_runtime';
  IF r.rolname IS NULL OR NOT r.rolcanlogin THEN
    RAISE EXCEPTION 'numina_app_runtime login is not enabled';
  END IF;
  IF r.rolsuper OR r.rolinherit OR r.rolcreaterole OR r.rolcreatedb
     OR r.rolreplication OR r.rolbypassrls
     OR pg_has_role('numina_app_runtime','neon_superuser','member') THEN
    RAISE EXCEPTION 'numina_app_runtime role attributes are elevated';
  END IF;
  IF has_schema_privilege('numina_app_runtime','public','CREATE') THEN
    RAISE EXCEPTION 'numina_app_runtime unexpectedly has public CREATE';
  END IF;
  IF pg_has_role('numina_owner','numina_app_runtime','USAGE')
     OR pg_has_role('numina_owner','numina_app_runtime','SET') THEN
    RAISE EXCEPTION 'numina_owner retains usable numina_app_runtime membership';
  END IF;

  IF NOT (
    has_table_privilege('numina_app_runtime','public.numina_evidence_records','SELECT')
    AND has_table_privilege('numina_app_runtime','public.numina_evidence_records','INSERT')
    AND has_table_privilege('numina_app_runtime','public.numina_evidence_records','UPDATE')
    AND NOT has_table_privilege('numina_app_runtime','public.numina_evidence_records','DELETE')
    AND has_table_privilege('numina_app_runtime','public.numina_verification_jobs','SELECT')
    AND has_table_privilege('numina_app_runtime','public.numina_verification_jobs','INSERT')
    AND has_table_privilege('numina_app_runtime','public.numina_verification_jobs','UPDATE')
    AND NOT has_table_privilege('numina_app_runtime','public.numina_verification_jobs','DELETE')
  ) THEN
    RAISE EXCEPTION 'numina_app_runtime evidence privileges are incorrect';
  END IF;

  IF has_table_privilege('numina_data_api_anon','public.numina_evidence_records','SELECT')
     OR has_table_privilege('numina_data_api_anon','public.numina_verification_jobs','SELECT') THEN
    RAISE EXCEPTION 'Data API anon role has direct durable-evidence table access';
  END IF;

  IF NOT has_function_privilege('numina_data_api_anon','public.numina_ingest_provider_evidence(jsonb)','EXECUTE')
     OR NOT has_function_privilege('numina_data_api_anon','public.numina_mark_trusted_production_release(jsonb)','EXECUTE')
     OR NOT has_function_privilege('skott34-dot/numina-production','public.numina_ingest_provider_evidence(jsonb)','EXECUTE')
     OR NOT has_function_privilege('skott34-dot/numina-production','public.numina_mark_trusted_production_release(jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'OIDC/Data API RPC EXECUTE grants are incomplete';
  END IF;

  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public'
        AND p.proname IN ('numina_ingest_provider_observation','numina_ingest_provider_evidence','numina_mark_trusted_production_release')
        AND pg_get_userbyid(p.proowner)='numina_app_runtime'
        AND p.prosecdef)=3 THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'evidence RPC ownership/security-definer alignment is incomplete';
  END IF;

  IF NOT (
    pg_get_functiondef('public.numina_mark_trusted_production_release(jsonb)'::regprocedure)
      LIKE '%numina.frontier-readiness.v3%'
    AND pg_get_functiondef('public.numina_mark_trusted_production_release(jsonb)'::regprocedure)
      LIKE '%numina_provider_of_record%'
    AND pg_get_functiondef('public.numina_mark_trusted_production_release(jsonb)'::regprocedure)
      NOT LIKE '%control_manifest_signature%'
  ) THEN
    RAISE EXCEPTION 'trusted-release RPC does not match the readiness-v3 contract';
  END IF;
END
$$;

SELECT jsonb_build_object(
  'schema','numina.neon.trusted-release-v3-verification.v1',
  'runtime_role','numina_app_runtime',
  'login_enabled',(SELECT rolcanlogin FROM pg_roles WHERE rolname='numina_app_runtime'),
  'inherits_neon_superuser',pg_has_role('numina_app_runtime','neon_superuser','member'),
  'runtime_public_create',has_schema_privilege('numina_app_runtime','public','CREATE'),
  'owner_can_set_runtime',pg_has_role('numina_owner','numina_app_runtime','SET'),
  'data_api_direct_evidence_select',has_table_privilege('numina_data_api_anon','public.numina_evidence_records','SELECT'),
  'data_api_provider_rpc_execute',has_function_privilege('numina_data_api_anon','public.numina_ingest_provider_evidence(jsonb)','EXECUTE'),
  'data_api_trusted_rpc_execute',has_function_privilege('numina_data_api_anon','public.numina_mark_trusted_production_release(jsonb)','EXECUTE'),
  'readiness_contract','numina.frontier-readiness.v3',
  'verified',true
) AS verification;
