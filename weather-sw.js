const VERSION='20260916-perf-1';
const SHELL_CACHE=`weather-shell-${VERSION}`;
const DATA_CACHE=`weather-data-${VERSION}`;
const IMMUTABLE_CACHE=`weather-immutable-${VERSION}`;
const SHELL=[
  '/',
  '/index.html',
  '/weather-dashboard.css?v=20260916-standalone-2',
  '/weather-dashboard.js?v=20260916-standalone-2',
  '/weather-standalone-data.js?v=20260916-3',
  '/weather-manifest.webmanifest?v=20260916-2',
  '/weather-app-icon.svg?v=20260916-2',
  '/weather-history.html'
];

self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(SHELL_CACHE);
    await Promise.allSettled(SHELL.map(url=>cache.add(url)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keep=new Set([SHELL_CACHE,DATA_CACHE,IMMUTABLE_CACHE]);
    const keys=await caches.keys();
    await Promise.all(keys.filter(key=>key.startsWith('weather-')&&!keep.has(key)).map(key=>caches.delete(key)));
    await self.clients.claim();
  })());
});

async function cacheFirst(request,cacheName){
  const cache=await caches.open(cacheName);
  const hit=await cache.match(request);
  if(hit)return hit;
  const response=await fetch(request);
  if(response&&response.ok)cache.put(request,response.clone()).catch(()=>{});
  return response;
}

async function staleWhileRevalidate(request,cacheName){
  const cache=await caches.open(cacheName);
  const hit=await cache.match(request);
  const network=fetch(request).then(response=>{
    if(response&&response.ok)cache.put(request,response.clone()).catch(()=>{});
    return response;
  }).catch(()=>null);
  if(hit){
    network.catch(()=>{});
    return hit;
  }
  const response=await network;
  if(response)return response;
  throw new Error('Weather asset unavailable');
}

async function networkFirst(request,cacheName,timeoutMs=3500){
  const cache=await caches.open(cacheName);
  let timer;
  try{
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('timeout')),timeoutMs)});
    const response=await Promise.race([fetch(request),timeout]);
    clearTimeout(timer);
    if(response&&response.ok)cache.put(request,response.clone()).catch(()=>{});
    return response;
  }catch(error){
    clearTimeout(timer);
    const hit=await cache.match(request);
    if(hit)return hit;
    throw error;
  }
}

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);

  if(request.mode==='navigate'&&url.origin===self.location.origin){
    event.respondWith(networkFirst(request,SHELL_CACHE,2500).catch(()=>caches.match('/index.html')));
    return;
  }

  if(url.origin===self.location.origin){
    if(/\.(?:css|js|svg|webmanifest)(?:$|\?)/i.test(url.pathname+url.search)||url.pathname==='/index.html'||url.pathname==='/weather-history.html'){
      event.respondWith(staleWhileRevalidate(request,SHELL_CACHE));
    }
    return;
  }

  if(url.hostname==='cdn.jsdelivr.net'&&url.pathname.includes('/gh/kenzuko/Jotrip-Lab@fa2b76f35cb1b8031023c95508246ceee484152c/')){
    event.respondWith(cacheFirst(request,IMMUTABLE_CACHE));
    return;
  }

  if((url.hostname==='raw.githubusercontent.com'||url.hostname==='api.github.com')&&url.href.includes('kenzuko/Jotrip-Lab')){
    event.respondWith(networkFirst(request,DATA_CACHE,3500));
  }
});
