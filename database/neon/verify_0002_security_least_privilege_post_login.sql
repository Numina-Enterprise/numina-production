-- NUMINA least-privilege post-cutover verification.
-- Read-only assertions after numina_app_runtime LOGIN has been explicitly enabled
-- and a credential has been provisioned through a secure operator channel.
--
-- This does not validate the secret value itself. Successful application traffic
-- through the role-specific connection is still required before legacy-role retirement.

DO $$
DECLARE r pg_roles%ROWTYPE;
BEGIN
  SELECT * INTO r FROM pg_roles WHERE rolname='numina_app_runtime';

  IF r.rolname IS NULL THEN
    RAISE EXCEPTION 'numina_app_runtime does not exist';
  END IF;

  IF NOT r.rolcanlogin THEN
    RAISE EXCEPTION 'numina_app_runtime LOGIN is not enabled';
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
    RAISE EXCEPTION 'numina_app_runtime unexpectedly inherits another role';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_auth_members m
    JOIN pg_roles member_role ON member_role.oid=m.member
    JOIN pg_roles parent_role ON parent_role.oid=m.roleid
    JOIN pg_roles grantor_role ON grantor_role.oid=m.grantor
    WHERE parent_role.rolname='numina_app_runtime'
      AND NOT (
        member_role.rolname='numina_owner'
        AND grantor_role.rolname='cloud_admin'
        AND m.admin_option
        AND NOT COALESCE(m.inherit_option,true)
        AND NOT COALESCE(m.set_option,true)
      )
  ) THEN
    RAISE EXCEPTION 'numina_app_runtime has unexpected usable or non-owner membership grants';
  END IF;

  IF pg_has_role('numina_owner','numina_app_runtime','USAGE')
     OR pg_has_role('numina_owner','numina_app_runtime','SET') THEN
    RAISE EXCEPTION 'numina_owner can unexpectedly inherit or SET ROLE numina_app_runtime';
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
END
$$;

SELECT jsonb_build_object(
  'schema','numina.neon.least-privilege-post-login-verification.v1',
  'runtime_role','numina_app_runtime',
  'login_enabled',(SELECT rolcanlogin FROM pg_roles WHERE rolname='numina_app_runtime'),
  'inherits_neon_superuser',pg_has_role('numina_app_runtime','neon_superuser','member'),
  'administrative_owner_membership_only',NOT EXISTS (
    SELECT 1 FROM pg_auth_members m
    JOIN pg_roles member_role ON member_role.oid=m.member
    JOIN pg_roles parent_role ON parent_role.oid=m.roleid
    JOIN pg_roles grantor_role ON grantor_role.oid=m.grantor
    WHERE parent_role.rolname='numina_app_runtime'
      AND NOT (member_role.rolname='numina_owner' AND grantor_role.rolname='cloud_admin'
               AND m.admin_option AND NOT COALESCE(m.inherit_option,true)
               AND NOT COALESCE(m.set_option,true))
  ),
  'evidence_table_write',true,
  'verification_jobs_write',true,
  'public_evidence_read_only',true,
  'show_db_tree_public_execute',has_function_privilege('public','public.show_db_tree()','EXECUTE'),
  'credential_and_traffic_verification_required',true,
  'verified',true
) AS verification;
