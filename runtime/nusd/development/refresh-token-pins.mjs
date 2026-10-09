import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const artifactPath=path.join(root,'artifacts/NuminaUSD.json');
const sourcePath=path.join(root,'contracts/NuminaUSD.sol');
const target=path.join(root,'scripts/token-artifact.mjs');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const artifactSha=sha(fs.readFileSync(artifactPath));
const sourceSha=sha(fs.readFileSync(sourcePath));
let body=fs.readFileSync(target,'utf8');
body=body.replace(/export const TOKEN_ARTIFACT_SHA256 = '[a-f0-9]{64}';/, `export const TOKEN_ARTIFACT_SHA256 = '${artifactSha}';`);
body=body.replace(/export const TOKEN_SOURCE_SHA256 = '[a-f0-9]{64}';/, `export const TOKEN_SOURCE_SHA256 = '${sourceSha}';`);
fs.writeFileSync(target,body);
console.log(JSON.stringify({artifactSha256:artifactSha,sourceSha256:sourceSha}));
