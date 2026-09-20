const VERSION="weather-intelligence-2026.09.20.prod16";
const CACHE=`${VERSION}-static`;
const STATIC=[
  "/",
  "/index.html",
  "/weather-v2.css?v=20260920-prod16",
  "/weather-v2.js?v=20260920-prod16",
  "/weather-brand.svg",
  "/weather-app-icon.svg",
  "/favicon-64.png",
  "/apple-touch-icon.png",
  "/weather-manifest.webmanifest"
];

self.addEventListener("install",event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE);
    await Promise.allSettled(STATIC.map(async url=>{
      const response=await fetch(url,{cache:"reload"});
      if(response.ok)await cache.put(url,response.clone());
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate",event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k.startsWith("weather-")&&k!==CACHE).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("message",event=>{
  if(event.data?.type==="SKIP_WAITING")self.skipWaiting();
});

self.addEventListener("fetch",event=>{
  const request=event.request;
  if(request.method!=="GET")return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin)return;

  const shell=
    url.pathname==="/"||
    url.pathname==="/index.html"||
    url.pathname==="/weather.html"||
    url.pathname==="/weather-v2.css"||
    url.pathname==="/weather-v2.js"||
    url.pathname==="/weather-brand.svg"||
    url.pathname==="/weather-app-icon.svg"||
    url.pathname==="/weather-manifest.webmanifest"||
    url.pathname==="/weather-history.html"||
    url.pathname==="/weather-history.css"||
    url.pathname==="/weather-history.js";

  if(!shell)return;

  event.respondWith((async()=>{
    try{
      const response=await fetch(request,{cache:"no-store"});
      if(response.ok){
        const cache=await caches.open(CACHE);
        cache.put(request,response.clone()).catch(()=>{});
      }
      return response;
    }catch{
      return (await caches.match(request))||(request.mode==="navigate"?(await caches.match("/index.html")):Response.error());
    }
  })());
});