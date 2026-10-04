import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {APP_CONSENT_VERSION} from '../src/app-core.js';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('current operator guidance names human accountability without inventing operational coverage or changing privacy acceptance',()=>{
 assert.match(read('public/authority.html'),/Sam Kott is the accountable human/);
 assert.match(read('public/authority.html'),/do not create legal officers or independent contracting authority/);
 const doc=read('docs/Numina-Security.md');
 assert.match(doc,/Current-process telemetry does not establish continuous security monitoring/);
 assert.match(doc,/a completed drill or staffed response SLA is not yet documented/);
 assert.match(doc,/The September 15 local build and root test suite passed/);
 assert.match(doc,/without an offline fallback/);assert.doesNotMatch(read('public/app-sw.js'),/caches\.put|cache\.put|caches\.match/);
 assert.equal(APP_CONSENT_VERSION,'numina-workspace-2026-10-04');
 assert.equal(createHash('sha256').update(read('docs/history/Numina-Security-2026-09-15.md')).digest('hex'),'63e4fe29fa772d914342de4a5b9011170d19238621434a8c9a317a9681b12f97');
});
