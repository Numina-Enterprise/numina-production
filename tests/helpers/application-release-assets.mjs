import {readFileSync} from 'node:fs';

export function applicationReleaseAssets(){
  const bytes=readFileSync(new URL('../../dist/client/downloads/application-release-v4.json',import.meta.url));
  return {async fetch(request){
    return new URL(request.url).pathname==='/downloads/application-release-v4.json'
      ?new Response(bytes,{headers:{'Content-Type':'application/json'}})
      :new Response(null,{status:404});
  }};
}
