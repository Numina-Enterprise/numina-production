import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>JSON.parse(readFileSync(new URL('../'+path,import.meta.url)));
test('generated package timestamps use the exact source-pinned build clock without claiming deployment evidence',()=>{
 const clock=read('config/build-clock.json'),epoch=clock.sourceDateEpoch*1000;
 assert.equal(clock.schema,'numina.reproducible-build-clock.v1');assert.ok(Number.isSafeInteger(clock.sourceDateEpoch));assert.equal(Date.parse(clock.timestamp),epoch);
 for(const file of ['integrations/numina/verification.json','docs/integration-kit-v4.0.0-record.json'])assert.equal(Date.parse(read(file).packagedAtUtc),epoch,file);
 const native=read('docs/native-package-record-v4.json');
 for(const key of ['sourcePackagedAtUtc','iosSourcePackagedAtUtc'])assert.equal(Date.parse(native[key]),epoch,key);
 assert.deepEqual(read('dist/client/source-alignment.json').buildClock,clock);
});
