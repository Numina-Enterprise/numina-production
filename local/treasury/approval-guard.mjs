// Stripe's live money-movement approval can never be recorded as off, and the client never sends
// anything that tries to skip it. The guard runs on config writes and on every outgoing call.
export class ApprovalBypassError extends Error{constructor(message){super(message);this.name='ApprovalBypassError';this.code='APPROVAL_BYPASS_REJECTED';}}
export const STRIPE_APPROVAL_REQUIRED='required';

const APPROVAL_WORD=/approv|confirm|review/i;
const WEAKEN_WORD=/skip|bypass|disable|override|suppress|auto|without|^no[_-]|pre[_-]?approv|force/i;
const OFF_VALUES=new Set([false,'false','off','none','disabled','skip','0',0,'never','auto','automatic','not_required','optional','no']);
const isOff=v=>OFF_VALUES.has(typeof v==='string'?v.toLowerCase():v);

// Throws when a config object tries to record Stripe's approval as anything but required.
export function assertApprovalConfig(config,where='config'){
  scan(config,where,(path,key,value)=>{
    if(key==='stripeLiveApproval'||key==='stripeApproval'){
      if(value!==STRIPE_APPROVAL_REQUIRED)throw new ApprovalBypassError(`${path}: Stripe's live money-movement approval is always "required" and cannot be changed`);
      return;
    }
    if(APPROVAL_WORD.test(key)&&(WEAKEN_WORD.test(key)||isOff(value)))
      throw new ApprovalBypassError(`${path}: settings that weaken or skip Stripe approval are rejected`);
  });
}

// Throws when outgoing tool arguments try to skip approval. The only approval-related field
// passed through is a top-level token/id field the server's own inputSchema declares (the token
// Stripe returns after a human approves in the Dashboard: Stripe's documented retry flow).
export function assertNoBypassInArgs(args,inputSchema){
  const declared=new Set(Object.keys(inputSchema?.properties||{}));
  scan(args,'args',(path,key,value)=>{
    if(!APPROVAL_WORD.test(key))return;
    if(WEAKEN_WORD.test(key)||isOff(value))throw new ApprovalBypassError(`${path}: arguments that try to skip or turn off Stripe approval are not sent`);
    const topLevel=path.split('.').length===2;
    if(!(topLevel&&declared.has(key)&&/token|_id$/i.test(key)&&typeof value==='string'))throw new ApprovalBypassError(`${path}: approval fields not declared by the server schema are not sent`);
  });
}
function scan(obj,path,fn,depth=0){
  if(!obj||typeof obj!=='object'||depth>20)return;
  for(const [k,v] of Object.entries(obj)){const p=`${path}.${k}`;fn(p,k,v);if(v&&typeof v==='object')scan(v,p,fn,depth+1);}
}

// Recognise a tool result that says Stripe is waiting for a human to approve in the Dashboard.
export function detectPendingApproval(result){
  const text=JSON.stringify(result??'');
  const url=text.match(/https:\/\/dashboard\.stripe\.com\/[^"\s\\]*(approv|confirm|review)[^"\s\\]*/i)?.[0];
  const flagged=/requires?[_ ](human[_ ])?(approval|confirmation)|pending[_ ](approval|confirmation)|approval[_ ]required/i.test(text);
  return url||flagged?{pending:true,approvalUrl:url||null}:{pending:false};
}
