import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const archive=process.argv[2];if(!archive)throw Error('Supply an archive destination outside dist.');
for(const path of ['dist/server/index.js','dist/client/app.html','dist/.openai/hosting.json','dist/.openai/drizzle/meta/_journal.json'])if(!existsSync(path))throw Error('Missing build output: '+path);
if(resolve(archive).startsWith(resolve('dist')))throw Error('Archive must be outside dist.');
const journal=JSON.parse(readFileSync('dist/.openai/drizzle/meta/_journal.json'));
for(const entry of journal.entries)if(!existsSync('dist/.openai/drizzle/'+entry.tag+'.sql'))throw Error('Missing generated migration: '+entry.tag);
// Match the Sites packager: runtime manifest and migrations live under dist/.openai.
execFileSync('tar',['-czf',resolve(archive),'dist'],{stdio:'inherit'});
const entries=execFileSync('tar',['-tzf',resolve(archive)],{encoding:'utf8'}).split(/\r?\n/);
for(const entry of ['dist/.openai/hosting.json','dist/server/index.js',...journal.entries.map(e=>'dist/.openai/drizzle/'+e.tag+'.sql')])if(!entries.includes(entry))throw Error('Incomplete archive: '+entry);
console.log('Validated Worker, static assets and all migrations in the Sites archive.');
