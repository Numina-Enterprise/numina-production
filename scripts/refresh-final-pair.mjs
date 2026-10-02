import {execFileSync} from 'node:child_process';

execFileSync(process.execPath,['scripts/sync-universal-pair-source-ids.mjs'],{stdio:'inherit'});
