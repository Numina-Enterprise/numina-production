// Refresh maintained source companions. No signed runtime or historical binary is edited.
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {writeLegalCompanion} from '../integrations/numina/scripts/legal-distribution.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const targets=['integrations/numina','integrations/codex/numina','mobile/android','mobile/ios'];
for(const target of targets)writeLegalCompanion(resolve(root,target,'legal'),resolve(root,'public'));
console.log(JSON.stringify({identity:'NUMINA',scope:'maintained_source_companions',targets,signedArtifactsChanged:false,installedBinaryCoverageVerified:false}));
