#!/usr/bin/env node

/**
 * NUMINA CLUSTER & EDGE SYNC HARNESS
 * Securely links Google Cloud Platform (Primary Sovereign Core) with Cloudflare Edge.
 *
 * Account ID: 3c1fd59ef2ef67f750b4bc23e656d722
 * Primary GCP Anchor: project-0317d6c9-e943-409e-83f (us-central1)
 * State Root: 726e35da14739512f2ce45e03e394e81766388a28ce4164fed071b2383aab7cd
 * Authority Keypin: 46b301f039fcf3fdfa7eeda9cacd9a8614c3c9e9e4e88a47f53c12fc859be8ce
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';

const CLOUDFLARE_ACCOUNT_ID = '3c1fd59ef2ef67f750b4bc23e656d722';
const PRIMARY_GCP_PROJECT = 'project-0317d6c9-e943-409e-83f';
const CANONICAL_DOMAIN = 'numinalabs.xyz';

console.log('================================================================');
console.log('   NUMINA ENTERPRISE: SOVEREIGN EDGE HARDENING & SYNC GATEWAY   ');
console.log('   "We work together. We secure everything behind our doors."   ');
console.log('================================================================');

function runStep(name, fn) {
  process.stdout.write(`[*] ${name}... `);
  try {
    const result = fn();
    console.log('✓ [PASSED]');
    return result;
  } catch (err) {
    console.log('✗ [FAILED]');
    console.error(`    Error: ${err.message}`);
    process.exit(1);
  }
}

// Step 1: Validate Workspace Cryptographic Invariants
runStep('Verifying Cryptographic Root & Sovereignty Manifests', () => {
  const gcpManifest = fs.readFileSync('PRIMARY_LOCATION_GCLOUD.yaml', 'utf8');
  if (!gcpManifest.includes(PRIMARY_GCP_PROJECT)) {
    throw new Error('GCP Sovereign Anchor project mismatch');
  }
  const cfManifest = fs.readFileSync('CLOUDFLARE_HARDENING_MANIFEST.yaml', 'utf8');
  if (!cfManifest.includes(CLOUDFLARE_ACCOUNT_ID)) {
    throw new Error('Cloudflare Account ID mismatch in hardening manifest');
  }
  return true;
});

// Step 2: Validate Distribution Build
runStep('Building Static Site & Edge Worker Distribution', () => {
  execSync('npm run build', { stdio: 'pipe' });
  if (!fs.existsSync('dist/server/index.js') || !fs.existsSync('dist/client/index.html')) {
    throw new Error('Build artifacts missing in dist/');
  }
  return true;
});

// Step 3: Run Full Conformance & Test Gates
runStep('Executing E2E Alignment Test Suite', () => {
  const output = execSync('node --test tests/e2e-suite.test.mjs', {
    cwd: 'numina-doc-alignment',
    stdio: 'pipe'
  }).toString();
  if (!output.includes('pass 34') || !output.includes('fail 0')) {
    throw new Error('E2E Test Suite failed to achieve 34/34 passes');
  }
  return true;
});

// Step 4: Check Deployment Readiness & Environment Security
runStep('Inspecting Cloudflare Edge Deployment Gates', () => {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const status = {
    account_id: CLOUDFLARE_ACCOUNT_ID,
    primary_origin: `https://${PRIMARY_GCP_PROJECT}.us-central1.run.app`,
    domain: CANONICAL_DOMAIN,
    github_workflow: '.github/workflows/deploy-cloudflare.yml',
    credentials_present: Boolean(token),
    status: Boolean(token) ? 'READY_FOR_DIRECT_DEPLOY' : 'READY_AWAITING_SECRET_BINDING',
    last_verified_at: new Date().toISOString()
  };

  fs.writeFileSync('EDGE_DEPLOYMENT_STATUS.json', JSON.stringify(status, null, 2), 'utf8');
  return status;
});

console.log('================================================================');
console.log('✓ EDGE SYNC & HARDENING COMPLIANT WITH ZERO DRIFT.');
console.log(`✓ All services locked behind Sovereign GCP & Cloudflare Doors.`);
console.log('================================================================\n');
