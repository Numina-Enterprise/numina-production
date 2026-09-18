-- NUMINA manifest evidence convergence.
-- Historical rows are preserved; only schema terminology and validators advance.
ALTER TABLE public.numina_evidence_records RENAME COLUMN state TO status;
ALTER TABLE public.numina_evidence_records RENAME COLUMN tx_hash TO source_commit;
ALTER TABLE public.numina_evidence_records RENAME COLUMN handoff_id TO related_record_id;
ALTER INDEX public.ux_numina_verified_tx RENAME TO ux_numina_verified_source_commit;
COMMENT ON TABLE public.numina_evidence_records IS 'Durable NUMINA manifest evidence records; historical rows are immutable evidence, not an alternate state authority.';
COMMENT ON COLUMN public.numina_evidence_records.status IS 'Manifest record status. Historical status values are preserved verbatim.';
COMMENT ON COLUMN public.numina_evidence_records.source_commit IS 'NUMINA source commit bound to this manifest record.';
COMMENT ON COLUMN public.numina_evidence_records.related_record_id IS 'Related NUMINA manifest record identifier, when applicable.';

CREATE OR REPLACE FUNCTION public.numina_ingest_provider_observation(manifest jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  claims jsonb := COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb,'{}'::jsonb);
  artifact jsonb := manifest->'artifact_json';
  transport_wrap jsonb;
  transport_observation jsonb;
  projection jsonb;
  observation jsonb;
  archive jsonb;
  assertions jsonb;
  observed_ts timestamptz;
  expected_record_id text;
  source_commit text;
  existing public.numina_evidence_records%ROWTYPE;
BEGIN
  IF claims->>'repository' <> 'skott34-dot/numina-production' THEN RAISE EXCEPTION 'GITHUB_REPOSITORY_INVALID'; END IF;
  IF claims->>'ref' <> 'refs/heads/main' THEN RAISE EXCEPTION 'GITHUB_REF_INVALID'; END IF;
  IF COALESCE(claims->>'workflow_ref','') NOT LIKE 'skott34-dot/numina-production/.github/workflows/verify-provider-observations.yml@refs/heads/main%' THEN RAISE EXCEPTION 'GITHUB_WORKFLOW_INVALID'; END IF;
  IF COALESCE(claims->>'sha','') !~ '^[0-9a-fA-F]{40}$' OR COALESCE(claims->>'run_id','') !~ '^[0-9]+$' OR COALESCE(claims->>'run_attempt','') !~ '^[0-9]+$' THEN RAISE EXCEPTION 'GITHUB_RUN_INVALID'; END IF;

  IF manifest->>'root'<>'NUMINA' OR manifest->>'manifest'<>'NUMINA' OR manifest->>'identity'<>'NUMINA'
     OR manifest->>'source'<>'NUMINA' OR manifest->>'evidence'<>'NUMINA' OR manifest->>'provider'<>'NUMINA'
     OR manifest->>'status'<>'PROVIDER_OBSERVATION_VERIFIED'
     OR manifest->>'artifact_type'<>'NUMINA_PROVIDER_OBSERVATION_SET'
     OR COALESCE((manifest->>'revoked')::boolean,true)<>false THEN RAISE EXCEPTION 'EVIDENCE_HEADER_INVALID'; END IF;
  IF COALESCE(manifest->>'artifact_root','') !~ '^[0-9a-fA-F]{64}$' THEN RAISE EXCEPTION 'EVIDENCE_ROOT_INVALID'; END IF;

  IF artifact->>'schema'<>'numina.evidence-record.v2' OR artifact->>'scope'<>'provider_observation'
     OR artifact->>'root'<>'NUMINA' OR artifact->>'manifest'<>'NUMINA' OR artifact->>'identity'<>'NUMINA'
     OR artifact->>'source'<>'NUMINA' OR artifact->>'evidence'<>'NUMINA' OR artifact->>'provider'<>'NUMINA' THEN RAISE EXCEPTION 'EVIDENCE_SCHEMA_INVALID'; END IF;
  source_commit := artifact->>'source_commit';
  IF source_commit<>claims->>'sha' OR source_commit !~ '^[0-9a-fA-F]{40}$' THEN RAISE EXCEPTION 'SOURCE_COMMIT_INVALID'; END IF;

  transport_wrap:=artifact->'transport'; transport_observation:=transport_wrap->'observation';
  IF transport_wrap->>'identity'<>'NUMINA' OR transport_wrap->>'role'<>'diagnostic_only'
     OR transport_observation->>'schema'<>'numina.transport-observation.v1'
     OR transport_observation->>'root'<>'NUMINA' OR transport_observation->>'manifest'<>'NUMINA'
     OR transport_observation->>'identity'<>'NUMINA' OR transport_observation->>'authority'<>'NUMINA'
     OR transport_observation->>'source'<>'NUMINA' OR transport_observation->>'evidence'<>'NUMINA'
     OR transport_observation->>'provider'<>'NUMINA' OR transport_observation->>'deployment'<>'NUMINA'
     OR transport_observation->>'transport'<>'vercel' OR COALESCE((transport_observation->>'authoritative')::boolean,true)<>false
     OR transport_observation->>'environment'<>'production' OR transport_observation->>'git_commit_ref'<>'main'
     OR transport_observation->>'runtime_release'<>'1.9.0-rc26'
     OR transport_observation->>'release'<>'core-v1.8+prod-v1.9.0-rc26' THEN RAISE EXCEPTION 'TRANSPORT_OBSERVATION_INVALID'; END IF;

  projection:=artifact->'provider_observation'->'observation_set';
  IF projection->>'root'<>'NUMINA' OR projection->>'manifest'<>'NUMINA' OR projection->>'identity'<>'NUMINA'
     OR projection->>'authority'<>'NUMINA' OR projection->>'source'<>'NUMINA' OR projection->>'evidence'<>'NUMINA'
     OR projection->>'provider'<>'NUMINA' OR projection->>'productionSource'<>'NUMINA' OR projection->>'surface'<>'provider-observations' THEN RAISE EXCEPTION 'PROVIDER_PROJECTION_INVALID'; END IF;
  observation:=projection->'payload';
  IF observation->>'schema'<>'numina.provider-observation-set.v1' OR observation->>'release'<>'1.9.0-rc26'
     OR observation->>'status'<>'HEALTHY' OR COALESCE((observation->>'all_healthy')::boolean,false)<>true
     OR COALESCE((observation->>'credentialed')::boolean,true)<>false OR observation->>'partnership_status'<>'asserted'
     OR COALESCE((observation->>'external_execution_performed')::boolean,true)<>false THEN RAISE EXCEPTION 'PROVIDER_SET_INVALID'; END IF;
  IF observation->'providers' <> '["arc","circle"]'::jsonb OR jsonb_array_length(observation->'observations')<>2 THEN RAISE EXCEPTION 'PROVIDER_IDENTITIES_INVALID'; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(observation->'observations') o WHERE o->>'provider'='circle' AND COALESCE((o->>'healthy')::boolean,false)=true AND (o->>'http_status')::int=200 AND o->'observed'->>'message'='pong') THEN RAISE EXCEPTION 'CIRCLE_OBSERVATION_INVALID'; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(observation->'observations') o WHERE o->>'provider'='arc' AND COALESCE((o->>'healthy')::boolean,false)=true AND (o->>'http_status')::int=200 AND (o->'observed'->>'chain_id')::bigint=5042002 AND (o->'observed'->>'latest_block')::bigint>=0) THEN RAISE EXCEPTION 'ARC_OBSERVATION_INVALID'; END IF;

  observed_ts := (observation->>'observed_at')::timestamptz;
  IF observed_ts < now()-interval '10 minutes' OR observed_ts > now()+interval '1 minute' THEN RAISE EXCEPTION 'PROVIDER_TIMESTAMP_INVALID'; END IF;
  IF (manifest->>'created_at')::bigint <> floor(extract(epoch from observed_ts))::bigint THEN RAISE EXCEPTION 'CREATED_AT_INVALID'; END IF;

  archive:=artifact->'archive';
  IF COALESCE((archive->>'available')::boolean,false)<>true OR COALESCE(archive->>'digest','') !~ '^sha256:[0-9a-fA-F]{64}$'
     OR archive->>'git_commit_sha'<>source_commit OR (archive->>'workflow_run_id')::bigint<>(claims->>'run_id')::bigint
     OR (archive->>'run_attempt')::int<>(claims->>'run_attempt')::int OR archive->>'workflow_name'<>'Verify provider observations' THEN RAISE EXCEPTION 'ARCHIVE_BINDING_INVALID'; END IF;

  assertions:=artifact->'assertions';
  IF COALESCE((assertions->>'transport_signature_verified')::boolean,false)<>true
     OR COALESCE((assertions->>'provider_observation_signature_verified')::boolean,false)<>true
     OR COALESCE((assertions->>'matching_github_evidence_available')::boolean,false)<>true
     OR assertions->>'provider_status'<>'HEALTHY' OR assertions->>'circle_message'<>'pong'
     OR (assertions->>'arc_chain_id')::bigint<>5042002 OR COALESCE((assertions->>'credentialed')::boolean,true)<>false
     OR assertions->>'partnership_status'<>'asserted' OR COALESCE((assertions->>'external_execution_performed')::boolean,true)<>false THEN RAISE EXCEPTION 'ASSERTIONS_INVALID'; END IF;

  expected_record_id := 'provider-observation-'||substr(source_commit,1,12)||'-'||to_char(observed_ts AT TIME ZONE 'UTC','YYYYMMDD"T"HH24MISS"Z"');
  IF manifest->>'record_id'<>expected_record_id THEN RAISE EXCEPTION 'RECORD_ID_INVALID'; END IF;

  INSERT INTO public.numina_evidence_records(record_id,source_commit,related_record_id,status,artifact_type,artifact_root,artifact_json,created_at,revoked,revocation_json)
  VALUES(manifest->>'record_id',source_commit,manifest->>'record_id',manifest->>'status',manifest->>'artifact_type',manifest->>'artifact_root',artifact,(manifest->>'created_at')::bigint,false,NULL)
  ON CONFLICT(record_id) DO NOTHING;
  SELECT * INTO existing FROM public.numina_evidence_records WHERE record_id=manifest->>'record_id';
  IF existing.record_id IS NULL OR existing.source_commit IS DISTINCT FROM source_commit OR existing.related_record_id IS DISTINCT FROM manifest->>'record_id'
     OR existing.status IS DISTINCT FROM manifest->>'status' OR existing.artifact_type IS DISTINCT FROM manifest->>'artifact_type'
     OR existing.artifact_root IS DISTINCT FROM manifest->>'artifact_root' OR existing.artifact_json IS DISTINCT FROM artifact
     OR existing.created_at IS DISTINCT FROM (manifest->>'created_at')::bigint OR existing.revoked IS DISTINCT FROM false THEN RAISE EXCEPTION 'READBACK_MISMATCH'; END IF;

  RETURN jsonb_build_object('committed',true,'read_back',true,'record_id',existing.record_id,'artifact_root',existing.artifact_root,
    'source_commit',source_commit,'git_commit_sha',source_commit,'deployment_id',transport_observation->>'deployment_id',
    'provider_status',observation->>'status','circle_message','pong','arc_chain_id',5042002,
    'arc_latest_block',(SELECT (o->'observed'->>'latest_block')::bigint FROM jsonb_array_elements(observation->'observations') o WHERE o->>'provider'='arc'),
    'archive_digest',archive->>'digest','credentialed',false,'partnership_status','asserted','external_execution_performed',false);
END
$function$;

CREATE OR REPLACE FUNCTION public.numina_mark_trusted_production_release(manifest jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  claims jsonb := COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb,'{}'::jsonb);
  artifact jsonb := manifest->'artifact_json';
  transport_wrap jsonb;
  transport_observation jsonb;
  provider_ref jsonb;
  readiness_wrap jsonb;
  readiness jsonb;
  readiness_receipt jsonb;
  fundable_targets jsonb;
  assertions jsonb;
  observed_ts timestamptz;
  expected_record_id text;
  source_commit text;
  provider_row public.numina_evidence_records%ROWTYPE;
  existing public.numina_evidence_records%ROWTYPE;
BEGIN
  IF claims->>'repository' <> 'skott34-dot/numina-production' THEN RAISE EXCEPTION 'GITHUB_REPOSITORY_INVALID'; END IF;
  IF claims->>'ref' <> 'refs/heads/main' THEN RAISE EXCEPTION 'GITHUB_REF_INVALID'; END IF;
  IF COALESCE(claims->>'workflow_ref','') NOT LIKE 'skott34-dot/numina-production/.github/workflows/verify-provider-observations.yml@refs/heads/main%' THEN RAISE EXCEPTION 'GITHUB_WORKFLOW_INVALID'; END IF;
  IF COALESCE(claims->>'sha','') !~ '^[0-9a-fA-F]{40}$' OR COALESCE(claims->>'run_id','') !~ '^[0-9]+$' OR COALESCE(claims->>'run_attempt','') !~ '^[0-9]+$' THEN RAISE EXCEPTION 'GITHUB_RUN_INVALID'; END IF;

  IF manifest->>'root'<>'NUMINA' OR manifest->>'manifest'<>'NUMINA' OR manifest->>'identity'<>'NUMINA'
     OR manifest->>'authority'<>'NUMINA' OR manifest->>'source'<>'NUMINA' OR manifest->>'evidence'<>'NUMINA'
     OR manifest->>'provider'<>'NUMINA' OR manifest->>'status'<>'TRUSTED_NUMINA_RELEASE'
     OR manifest->>'artifact_type'<>'NUMINA_TRUSTED_PRODUCTION_RELEASE'
     OR COALESCE((manifest->>'revoked')::boolean,true)<>false THEN RAISE EXCEPTION 'TRUSTED_RELEASE_HEADER_INVALID'; END IF;
  IF COALESCE(manifest->>'artifact_root','') !~ '^[0-9a-fA-F]{64}$' THEN RAISE EXCEPTION 'TRUSTED_RELEASE_ROOT_INVALID'; END IF;

  IF artifact->>'schema'<>'numina.trusted-production-release.v2' OR artifact->>'scope'<>'numina_release_gate'
     OR artifact->>'root'<>'NUMINA' OR artifact->>'manifest'<>'NUMINA' OR artifact->>'identity'<>'NUMINA'
     OR artifact->>'authority'<>'NUMINA' OR artifact->>'source'<>'NUMINA' OR artifact->>'evidence'<>'NUMINA'
     OR artifact->>'provider'<>'NUMINA' OR artifact->>'deployment'<>'NUMINA'
     OR COALESCE((artifact->>'deployed')::boolean,false)<>true THEN RAISE EXCEPTION 'TRUSTED_RELEASE_SCHEMA_INVALID'; END IF;
  source_commit:=artifact->>'source_commit';
  IF source_commit<>claims->>'sha' OR source_commit !~ '^[0-9a-fA-F]{40}$' THEN RAISE EXCEPTION 'TRUSTED_RELEASE_SOURCE_COMMIT_INVALID'; END IF;

  transport_wrap:=artifact->'transport'; transport_observation:=transport_wrap->'observation';
  IF transport_wrap->>'identity'<>'NUMINA' OR transport_wrap->>'role'<>'diagnostic_only'
     OR transport_observation->>'schema'<>'numina.transport-observation.v1'
     OR transport_observation->>'deployment'<>'NUMINA' OR transport_observation->>'transport'<>'vercel'
     OR COALESCE((transport_observation->>'authoritative')::boolean,true)<>false THEN RAISE EXCEPTION 'TRUSTED_RELEASE_TRANSPORT_INVALID'; END IF;
  IF transport_wrap->'receipt'->>'artifact_type'<>'NUMINA_TRANSPORT_OBSERVATION'
     OR transport_wrap->'receipt'->>'algorithm'<>'Ed25519'
     OR transport_wrap->'receipt'->>'key_id'<>'3a2fe594a7e10458ae89683f'
     OR transport_wrap->'receipt'->>'public_key'<>'UvvCGLBZUbCPJaDHqq0Ef0mkhMeA4CoPPe2GoWgkTr8='
     OR transport_wrap->'receipt'->'payload' IS DISTINCT FROM transport_observation THEN RAISE EXCEPTION 'TRUSTED_RELEASE_TRANSPORT_RECEIPT_INVALID'; END IF;

  provider_ref:=artifact->'provider_evidence';
  IF COALESCE(provider_ref->>'record_id','')='' OR COALESCE(provider_ref->>'artifact_root','') !~ '^[0-9a-fA-F]{64}$'
     OR COALESCE(provider_ref->>'archive_digest','') !~ '^sha256:[0-9a-fA-F]{64}$' THEN RAISE EXCEPTION 'TRUSTED_RELEASE_PROVIDER_REFERENCE_INVALID'; END IF;
  SELECT * INTO provider_row FROM public.numina_evidence_records WHERE record_id=provider_ref->>'record_id';
  IF provider_row.record_id IS NULL OR provider_row.source_commit IS DISTINCT FROM source_commit
     OR provider_row.status IS DISTINCT FROM 'PROVIDER_OBSERVATION_VERIFIED'
     OR provider_row.artifact_type IS DISTINCT FROM 'NUMINA_PROVIDER_OBSERVATION_SET'
     OR provider_row.artifact_root IS DISTINCT FROM provider_ref->>'artifact_root' OR provider_row.revoked IS DISTINCT FROM false THEN RAISE EXCEPTION 'TRUSTED_RELEASE_PROVIDER_RECORD_INVALID'; END IF;
  IF provider_row.artifact_json->'archive'->>'digest' IS DISTINCT FROM provider_ref->>'archive_digest'
     OR provider_row.artifact_json->'assertions'->>'provider_status' IS DISTINCT FROM 'HEALTHY'
     OR provider_row.artifact_json->'assertions'->>'circle_message' IS DISTINCT FROM 'pong'
     OR (provider_row.artifact_json->'assertions'->>'arc_chain_id')::bigint<>5042002
     OR COALESCE((provider_row.artifact_json->'assertions'->>'credentialed')::boolean,true)<>false
     OR provider_row.artifact_json->'assertions'->>'partnership_status' IS DISTINCT FROM 'asserted'
     OR COALESCE((provider_row.artifact_json->'assertions'->>'external_execution_performed')::boolean,true)<>false THEN RAISE EXCEPTION 'TRUSTED_RELEASE_PROVIDER_BINDING_INVALID'; END IF;

  readiness_wrap:=artifact->'readiness'; readiness:=readiness_wrap->'readiness'; readiness_receipt:=readiness_wrap->'receipt';
  IF readiness_receipt->>'artifact_type'<>'NUMINA_FRONTIER_READINESS' OR readiness_receipt->>'algorithm'<>'Ed25519'
     OR readiness_receipt->>'key_id'<>'3a2fe594a7e10458ae89683f'
     OR readiness_receipt->>'public_key'<>'UvvCGLBZUbCPJaDHqq0Ef0mkhMeA4CoPPe2GoWgkTr8='
     OR readiness_receipt->'payload' IS DISTINCT FROM readiness THEN RAISE EXCEPTION 'TRUSTED_RELEASE_READINESS_RECEIPT_INVALID'; END IF;
  IF readiness->>'schema'<>'numina.frontier-readiness.v2' OR readiness->>'root'<>'NUMINA' OR readiness->>'manifest'<>'NUMINA'
     OR readiness->>'deployment'<>'NUMINA' OR COALESCE((readiness->>'deployed')::boolean,false)<>true
     OR COALESCE((readiness->>'ready')::boolean,false)<>true OR readiness->>'mode'<>'NUMINA' THEN RAISE EXCEPTION 'TRUSTED_RELEASE_READINESS_INVALID'; END IF;
  IF readiness->'runtime'->>'root'<>'NUMINA' OR readiness->'runtime'->>'deployment'<>'NUMINA'
     OR readiness->'runtime'->>'production_version'<>'1.9.0-rc26'
     OR readiness->'runtime'->>'release'<>'core-v1.8+prod-v1.9.0-rc26' THEN RAISE EXCEPTION 'TRUSTED_RELEASE_READINESS_BINDING_INVALID'; END IF;
  IF COALESCE((readiness->'checks'->>'application_release_valid')::boolean,false)<>true
     OR COALESCE((readiness->'checks'->>'application_runtime_binding')::boolean,false)<>true
     OR COALESCE((readiness->'checks'->>'runtime_manifest_identity')::boolean,false)<>true
     OR COALESCE((readiness->'checks'->>'release_attestation_signature')::boolean,false)<>true
     OR COALESCE((readiness->'checks'->>'supply_chain_identity')::boolean,false)<>true
     OR COALESCE((readiness->'checks'->>'control_manifest_signature')::boolean,false)<>true
     OR COALESCE((readiness->'checks'->>'execution_authorization_bounded')::boolean,false)<>true
     OR COALESCE((readiness->'checks'->>'numina_deployment')::boolean,false)<>true THEN RAISE EXCEPTION 'TRUSTED_RELEASE_READINESS_CHECKS_INVALID'; END IF;

  fundable_targets:=readiness->'fundable_targets';
  IF fundable_targets->>'schema'<>'numina.fundable-targets.v1' OR fundable_targets->>'scope'<>'numina_native'
     OR fundable_targets->>'target_display'<>'500T' OR fundable_targets->>'target_amount'<>'500000000000000'
     OR fundable_targets->>'status'<>'TARGET_BOUND' OR COALESCE((fundable_targets->>'external_balance_verified')::boolean,true)<>false
     OR COALESCE((fundable_targets->>'external_backing_asserted')::boolean,true)<>false
     OR COALESCE((fundable_targets->>'external_funds_moved')::boolean,true)<>false THEN RAISE EXCEPTION 'TRUSTED_RELEASE_FUNDABLE_TARGET_INVALID'; END IF;
  IF artifact->'fundable_targets' IS DISTINCT FROM fundable_targets THEN RAISE EXCEPTION 'TRUSTED_RELEASE_FUNDABLE_TARGET_BINDING_INVALID'; END IF;

  assertions:=artifact->'assertions';
  IF COALESCE((assertions->>'numina_deployment')::boolean,false)<>true
     OR COALESCE((assertions->>'readiness_signature_verified')::boolean,false)<>true
     OR COALESCE((assertions->>'transport_signature_verified')::boolean,false)<>true
     OR COALESCE((assertions->>'all_readiness_checks_passed')::boolean,false)<>true
     OR COALESCE((assertions->>'provider_evidence_workflow_verified')::boolean,false)<>true
     OR assertions->>'provider_status'<>'HEALTHY' OR assertions->>'circle_message'<>'pong'
     OR (assertions->>'arc_chain_id')::bigint<>5042002 OR COALESCE((assertions->>'credentialed')::boolean,true)<>false
     OR assertions->>'partnership_status'<>'asserted' OR COALESCE((assertions->>'external_execution_performed')::boolean,true)<>false
     OR COALESCE((assertions->>'execution_authorization_bounded')::boolean,false)<>true
     OR COALESCE((assertions->>'live_submission_enabled')::boolean,false)<>true
     OR assertions->>'live_submission_provider'<>'arc' OR COALESCE((assertions->>'owner_authorization_required')::boolean,false)<>true
     OR COALESCE((assertions->>'pre_signed_payload_required')::boolean,false)<>true
     OR assertions->>'fundable_target'<>'500T' OR assertions->>'fundable_target_amount'<>'500000000000000'
     OR assertions->>'fundable_target_scope'<>'numina_native' OR COALESCE((assertions->>'external_balance_verified')::boolean,true)<>false
     OR COALESCE((assertions->>'external_backing_asserted')::boolean,true)<>false THEN RAISE EXCEPTION 'TRUSTED_RELEASE_ASSERTIONS_INVALID'; END IF;

  observed_ts := (readiness->>'observed_at')::timestamptz;
  IF observed_ts < now()-interval '10 minutes' OR observed_ts > now()+interval '1 minute' THEN RAISE EXCEPTION 'TRUSTED_RELEASE_TIMESTAMP_INVALID'; END IF;
  IF (manifest->>'created_at')::bigint<>floor(extract(epoch from observed_ts))::bigint THEN RAISE EXCEPTION 'TRUSTED_RELEASE_CREATED_AT_INVALID'; END IF;
  expected_record_id := 'trusted-numina-'||substr(source_commit,1,12)||'-'||to_char(observed_ts AT TIME ZONE 'UTC','YYYYMMDD"T"HH24MISS"Z"');
  IF manifest->>'record_id'<>expected_record_id THEN RAISE EXCEPTION 'TRUSTED_RELEASE_RECORD_ID_INVALID'; END IF;

  INSERT INTO public.numina_evidence_records(record_id,source_commit,related_record_id,status,artifact_type,artifact_root,artifact_json,created_at,revoked,revocation_json)
  VALUES(manifest->>'record_id',source_commit,provider_ref->>'record_id',manifest->>'status',manifest->>'artifact_type',manifest->>'artifact_root',artifact,(manifest->>'created_at')::bigint,false,NULL)
  ON CONFLICT(record_id) DO NOTHING;
  SELECT * INTO existing FROM public.numina_evidence_records WHERE record_id=manifest->>'record_id';
  IF existing.record_id IS NULL OR existing.source_commit IS DISTINCT FROM source_commit OR existing.related_record_id IS DISTINCT FROM provider_ref->>'record_id'
     OR existing.status IS DISTINCT FROM manifest->>'status' OR existing.artifact_type IS DISTINCT FROM manifest->>'artifact_type'
     OR existing.artifact_root IS DISTINCT FROM manifest->>'artifact_root' OR existing.artifact_json IS DISTINCT FROM artifact
     OR existing.created_at IS DISTINCT FROM (manifest->>'created_at')::bigint OR existing.revoked IS DISTINCT FROM false THEN RAISE EXCEPTION 'TRUSTED_RELEASE_READBACK_MISMATCH'; END IF;

  RETURN jsonb_build_object('committed',true,'read_back',true,'record_id',existing.record_id,'artifact_root',existing.artifact_root,
    'source_commit',source_commit,'git_commit_sha',source_commit,'deployment_id',transport_observation->>'deployment_id',
    'provider_evidence_record_id',provider_ref->>'record_id','provider_artifact_root',provider_ref->>'artifact_root',
    'archive_digest',provider_ref->>'archive_digest','readiness_observed_at',readiness->>'observed_at',
    'provider_status','HEALTHY','circle_message','pong','arc_chain_id',5042002,'credentialed',false,
    'partnership_status','asserted','external_execution_performed',false,'execution_authorization_bounded',true,
    'live_submission_enabled',true,'live_submission_provider','arc','owner_authorization_required',true,
    'pre_signed_payload_required',true,'fundable_target','500T','fundable_target_amount','500000000000000',
    'fundable_target_scope','numina_native','external_balance_verified',false,'external_backing_asserted',false);
END
$function$;
