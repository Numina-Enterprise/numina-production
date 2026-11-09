// Local MOCK of a Streamable HTTP MCP server + OAuth authorization server, bound to 127.0.0.1.
// Tool names follow docs.stripe.com/mcp; the input schemas below are GUESSES for testing only
// (the real schemas are only known from tools/list on the live server).
import {createServer} from 'node:http';
import {createHash,randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';

const registry=JSON.parse(readFileSync(new URL('../../local/treasury/registry.json',import.meta.url),'utf8'));
const amount={anyOf:[{type:'integer',minimum:0},{type:'string'}]};
export const MOCK_SCHEMAS={
  get_balance_summary:{type:'object',properties:{financial_account:{type:'string'}},additionalProperties:false},
  convert_currency:{type:'object',properties:{financial_account:{type:'string'},amount,source_currency:{type:'string'},target_currency:{type:'string'}},required:['amount','source_currency','target_currency'],additionalProperties:false},
  send_money:{type:'object',properties:{financial_account:{type:'string'},recipient_id:{type:'string'},amount,currency:{type:'string'},description:{type:'string'},approval_token:{type:'string'}},required:['recipient_id','amount','currency'],additionalProperties:false},
  setup_recipient:{type:'object',properties:{name:{type:'string'},country:{type:'string'},currency:{type:'string'}},required:['name'],additionalProperties:false},
  transfer_money:{type:'object',properties:{amount,currency:{type:'string'},source:{type:'string'},destination:{type:'string'}},required:['amount','currency','destination'],additionalProperties:false},
  stripe_api_write:{type:'object',properties:{method:{type:'string'},path:{type:'string'},params:{type:'object'}},required:['method','path']},
  stripe_api_read:{type:'object',properties:{path:{type:'string'},params:{type:'object'}},required:['path']},
  send_stripe_feedback:{type:'object',properties:{feedback:{type:'string'}},required:['feedback']},
  atlas_company_formation:{type:'object',properties:{action:{type:'string',enum:['list','retrieve','create','update','validate']}},required:['action']}
};
export const SAMPLE_ARGS={
  get_balance_summary:{},
  convert_currency:{amount:10000,source_currency:'usd',target_currency:'eur'},
  send_money:{recipient_id:'rcpt_test12345678',amount:'125.50',currency:'usd',description:'mock test'},
  setup_recipient:{name:'Mock Recipient',country:'US',currency:'usd'},
  transfer_money:{amount:500,currency:'usd',destination:'fa_test12345678'},
  stripe_api_write:{method:'POST',path:'/v1/refunds',params:{charge:'ch_test12345678',amount:100}},
  stripe_api_read:{path:'/v1/balance'},
  send_stripe_feedback:{feedback:'mock only'},
  atlas_company_formation:{action:'list'},
  stripe_api_search:{query:'refund'},stripe_api_details:{method:'create_refund'},get_stripe_account_info:{},
  stripe_analytics:{question:'MRR'},stripe_reports:{query:'balance'},search_stripe_documentation:{question:'treasury'},stripe_implementation_planner:{goal:'billing'}
};
const sha=s=>createHash('sha256').update(s).digest('base64url');

export async function startMockServer({apiKey,omitTools=[],extraTools=[],schemaOverrides={},liveApproval=true,oauth=false}={}){
  const requests=[];const sessions=new Set();const codes=new Map();const tokens=new Set();const refreshTokens=new Set();let origin;
  const tools=()=>[...registry.tools.filter(t=>!omitTools.includes(t.name)).map(t=>({name:t.name,description:t.description,inputSchema:schemaOverrides[t.name]||MOCK_SCHEMAS[t.name]||{type:'object',properties:{}}})),...extraTools];
  const state={requests,tokens,expireAll(){tokens.clear();},calls:()=>requests.filter(r=>r.body?.method==='tools/call')};
  const srv=createServer(async(req,res)=>{
    const chunks=[];for await(const c of req)chunks.push(c);const raw=Buffer.concat(chunks).toString('utf8');
    const url=new URL(req.url,origin);
    const send=(s,b,h={})=>{res.writeHead(s,{'Content-Type':'application/json',...h});res.end(b===undefined?'':JSON.stringify(b));};
    // ---- OAuth (RFC 9728 / 8414 / 7591 / PKCE) ----
    if(url.pathname==='/.well-known/oauth-protected-resource')return send(200,{resource:origin,authorization_servers:[origin+'/as'],scopes_supported:['mcp']});
    if(url.pathname==='/.well-known/oauth-authorization-server/as')return send(200,{issuer:origin+'/as',authorization_endpoint:origin+'/as/authorize',token_endpoint:origin+'/as/token',registration_endpoint:origin+'/as/register',code_challenge_methods_supported:['S256'],response_types_supported:['code']});
    if(url.pathname==='/as/register'){const b=JSON.parse(raw);state.registered=b;return send(201,{client_id:'mock-client-'+randomBytes(4).toString('hex'),redirect_uris:b.redirect_uris,token_endpoint_auth_method:'none'});}
    if(url.pathname==='/as/authorize'){
      const q=Object.fromEntries(url.searchParams);state.authorizeQuery=q;
      if(q.code_challenge_method!=='S256'||!q.code_challenge)return send(400,{error:'invalid_request'});
      const code=randomBytes(8).toString('hex');codes.set(code,q);
      const to=new URL(q.redirect_uri);to.searchParams.set('code',code);to.searchParams.set('state',q.state);
      res.writeHead(302,{Location:to.toString()});return res.end();
    }
    if(url.pathname==='/as/token'){
      const f=Object.fromEntries(new URLSearchParams(raw));state.tokenRequests=(state.tokenRequests||[]).concat([{grant_type:f.grant_type,resource:f.resource,hasVerifier:!!f.code_verifier}]);
      const issue=()=>{const at='mock_at_'+randomBytes(12).toString('hex'),rt='mock_rt_'+randomBytes(12).toString('hex');tokens.add(at);refreshTokens.add(rt);return send(200,{access_token:at,refresh_token:rt,token_type:'Bearer',expires_in:3600,scope:'mcp'});};
      if(f.grant_type==='authorization_code'){const q=codes.get(f.code);codes.delete(f.code);
        if(!q||sha(f.code_verifier||'')!==q.code_challenge||f.redirect_uri!==q.redirect_uri)return send(400,{error:'invalid_grant'});return issue();}
      if(f.grant_type==='refresh_token'){if(!refreshTokens.has(f.refresh_token))return send(400,{error:'invalid_grant'});refreshTokens.delete(f.refresh_token);return issue();}
      return send(400,{error:'unsupported_grant_type'});
    }
    // ---- MCP ----
    if(url.pathname!=='/mcp')return send(404,{error:'not found'});
    const authz=req.headers.authorization||'';const tok=authz.startsWith('Bearer ')?authz.slice(7):'';
    let body=null;try{body=raw?JSON.parse(raw):null;}catch{}
    requests.push({method:req.method,headers:{...req.headers},body});
    const okAuth=oauth?tokens.has(tok):tok===apiKey;
    if(!okAuth)return send(401,{error:'unauthorized'},{'WWW-Authenticate':`Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`});
    if(req.method==='DELETE'){sessions.delete(req.headers['mcp-session-id']);return send(204);}
    if(!body||body.jsonrpc!=='2.0')return send(400,{error:'bad request'});
    if(body.method==='initialize'){const sid='mock-session-'+randomBytes(6).toString('hex');sessions.add(sid);
      return send(200,{jsonrpc:'2.0',id:body.id,result:{protocolVersion:'2025-06-18',capabilities:{tools:{listChanged:false}},serverInfo:{name:'mock-stripe-mcp',version:'0.0.0-mock'}}},{'Mcp-Session-Id':sid});}
    if(!sessions.has(req.headers['mcp-session-id']))return send(400,{jsonrpc:'2.0',id:body.id??null,error:{code:-32600,message:'missing session'}});
    if(body.method==='notifications/initialized'){res.writeHead(202);return res.end();}
    if(body.method==='tools/list'){
      const all=tools();const start=Number(body.params?.cursor||0);const page=all.slice(start,start+6);const next=start+6<all.length?String(start+6):undefined;
      // Answer tools/list as an SSE stream to exercise that path.
      res.writeHead(200,{'Content-Type':'text/event-stream'});
      res.write(`event: message\ndata: ${JSON.stringify({jsonrpc:'2.0',method:'notifications/progress',params:{progress:1}})}\n\n`);
      res.end(`event: message\ndata: ${JSON.stringify({jsonrpc:'2.0',id:body.id,result:{tools:page,...(next?{nextCursor:next}:{})}})}\n\n`);return;
    }
    if(body.method==='tools/call'){
      const {name,arguments:args}=body.params;const spec=registry.tools.find(t=>t.name===name);
      if(!tools().some(t=>t.name===name))return send(200,{jsonrpc:'2.0',id:body.id,error:{code:-32602,message:'unknown tool'}});
      const moneyish=spec?.stripeHumanConfirmation===true||(name==='stripe_api_write'&&/refund/.test(args?.path||''));
      if(moneyish&&liveApproval&&!args?.approval_token)
        return send(200,{jsonrpc:'2.0',id:body.id,result:{content:[{type:'text',text:'This action requires human approval. Review it in the Dashboard: https://dashboard.stripe.com/test/approvals/mock_apr_123'}],structuredContent:{status:'requires_approval'}}});
      return send(200,{jsonrpc:'2.0',id:body.id,result:{content:[{type:'text',text:`mock ${name} ok`}],structuredContent:{mock:true,tool:name}}});
    }
    return send(200,{jsonrpc:'2.0',id:body.id,error:{code:-32601,message:'method not found'}});
  });
  await new Promise(r=>srv.listen(0,'127.0.0.1',r));
  origin=`http://127.0.0.1:${srv.address().port}`;
  return {...state,state,origin,url:origin+'/mcp',close:()=>new Promise(r=>{srv.closeAllConnections?.();srv.close(r);})};
}
