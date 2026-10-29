// The current app requires internet access. Never replace failed reads with code
// or responses from an older cached release; private writes are not intercepted.
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(
  caches.keys().then(keys=>Promise.all(
    keys.filter(key=>key.startsWith('numina-app-')).map(key=>caches.delete(key))
  )).then(()=>self.clients.claim())
));
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin)return;
  event.respondWith(fetch(request,{cache:'no-store'}));
});
