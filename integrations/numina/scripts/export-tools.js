import {mkdirSync,writeFileSync} from 'node:fs';
import {NUMINA_TOOLS} from '../src/tools.js';
import {providerTools} from '../src/provider-adapters.js';
const out=new URL('../schemas/',import.meta.url);mkdirSync(out,{recursive:true});
writeFileSync(new URL('provider-neutral.json',out),JSON.stringify(NUMINA_TOOLS,null,2)+'\n');
for(const provider of ['openai-chat-completions','openai-responses','anthropic-messages','gemini-interactions','gemini-generate-content']){
 writeFileSync(new URL(provider+'.json',out),JSON.stringify(providerTools(provider),null,2)+'\n');
 writeFileSync(new URL(provider+'-workflow.json',out),JSON.stringify(providerTools(provider,{profile:'workflow'}),null,2)+'\n');
}
