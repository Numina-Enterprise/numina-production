// Hosted Checkout plumbing. This branch has no product catalogue and no price ids.
// STRIPE_SECRET_KEY is the secret name already used in the repo. The price ids stay in
// STRIPE_PRICE_DIAGNOSTIC and STRIPE_PRICE_AUDIT, the bindings named by the checkout forms.
// Missing bindings fail closed. Nothing here is a treasury or financial-account call.
export const CHECKOUT_PATH='/api/payments/v1/checkout';
const HOSTED_CHECKOUT_ORIGIN='https://checkout.stripe.com';
const PRICE_ENV=Object.freeze({diagnostic:'STRIPE_PRICE_DIAGNOSTIC',audit:'STRIPE_PRICE_AUDIT'});
const SECRET=/^(?:sk|rk)_(?:test|live)_[A-Za-z0-9]+$/;
const PRICE=/^price_[A-Za-z0-9]+$/;

function json(error,status){
  return new Response(JSON.stringify({error}),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
}
function binding(env,name){
  const value=env?.[name];
  return typeof value==='string'?value.trim():'';
}
function hostedCheckoutUrl(value){
  if(typeof value!=='string'||value.length>2048)return '';
  try{
    const url=new URL(value);
    if(url.username||url.password||url.origin!==HOSTED_CHECKOUT_ORIGIN)return '';
    return url.href;
  }catch{return '';}
}
async function readOffering(req){
  if(req.headers.has('content-encoding'))return '';
  const reader=req.body?.getReader();
  if(!reader)return '';
  const chunks=[];let size=0;
  try{
    for(;;){
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>8192)return '';
      chunks.push(value);
    }
  }finally{void reader.cancel().catch(()=>{});}
  const bytes=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  let text='';
  try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return '';}
  const type=(req.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
  if(type==='application/json'){
    try{
      const body=JSON.parse(text);
      return body&&typeof body==='object'&&!Array.isArray(body)&&typeof body.offering==='string'?body.offering:'';
    }catch{return '';}
  }
  return new URLSearchParams(text).get('offering')||'';
}
function formEncode(fields){
  return Object.entries(fields).map(([key,value])=>encodeURIComponent(key)+'='+encodeURIComponent(String(value)).replace(/%5B/gi,'[').replace(/%5D/gi,']').replace(/%7B/gi,'{').replace(/%7D/gi,'}')).join('&');
}

export async function checkoutRedirect(req,env,{fetchImpl=globalThis.fetch}={}){
  const secret=binding(env,'STRIPE_SECRET_KEY');
  const offering=await readOffering(req);
  const priceName=PRICE_ENV[offering];
  const price=priceName?binding(env,priceName):'';
  if(!SECRET.test(secret)||!PRICE.test(price))return json('SERVICE_UNAVAILABLE',503);
  const origin=new URL(req.url).origin;
  let response;
  try{
    response=await fetchImpl('https://api.stripe.com/v1/checkout/sessions',{
      method:'POST',
      redirect:'manual',
      headers:{authorization:'Bearer '+secret,'content-type':'application/x-www-form-urlencoded'},
      body:formEncode({
        mode:'payment',
        'line_items[0][price]':price,
        'line_items[0][quantity]':'1',
        success_url:origin+'/checkout-success?session_id={CHECKOUT_SESSION_ID}',
        cancel_url:origin+'/checkout-cancel'
      })
    });
  }catch{return json('CHECKOUT_UNAVAILABLE',502);}
  const text=await response.text();
  if(!response.ok||response.redirected||(response.status>=300&&response.status<400))return json('CHECKOUT_UNAVAILABLE',502);
  let body={};
  try{body=text?JSON.parse(text):{};}catch{return json('CHECKOUT_UNAVAILABLE',502);}
  const location=hostedCheckoutUrl(body?.url);
  if(!location)return json('CHECKOUT_UNAVAILABLE',502);
  return new Response(null,{status:303,headers:{location,'cache-control':'no-store'}});
}
