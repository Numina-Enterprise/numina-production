// Shared adapter factory. Each file in adapters/ is generated from registry.json and calls
// makeAdapter(name). Adapters add tool-specific checks; transport, schema discovery, approval
// guard, validation, compliance (informational) and audit all run in service.mjs.
import {toolSpec,isWrite,movesMoney} from './registry.mjs';
import {ValidationError} from './validate.mjs';

const find=(obj,re,depth=0,out=[])=>{if(!obj||typeof obj!=='object'||depth>6)return out;for(const [k,v] of Object.entries(obj)){if(re.test(k))out.push(v);if(v&&typeof v==='object')find(v,re,depth+1,out);}return out;};
const CHECKS={
  convert_currency(args){
    const cur=find(args,/currency$/).filter(v=>typeof v==='string').map(v=>v.toLowerCase());
    if(cur.length>=2&&new Set(cur).size===1)throw new ValidationError('convert_currency: source and target currency must differ');
  },
  send_money(args){if(find(args,/amount/).some(v=>v===0||v==='0'))throw new ValidationError('send_money: amount must be greater than zero');},
  transfer_money(args){if(find(args,/amount/).some(v=>v===0||v==='0'))throw new ValidationError('transfer_money: amount must be greater than zero');},
  stripe_api_write(args){if(!Object.keys(args).length)throw new ValidationError('stripe_api_write: arguments required');}
};
export function makeAdapter(name){
  const spec=toolSpec(name);
  return Object.freeze({
    name,spec,
    kind:isWrite(spec)?'write':'read',
    movesMoney:movesMoney(spec),
    check(args){CHECKS[name]?.(args);},
    call(service,args={},opts={}){return service.call(name,args,{...opts,adapter:name});}
  });
}
