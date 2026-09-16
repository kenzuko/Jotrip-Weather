const CACHE='jotrip-weather-shell-v4';
const SHELL=[
  '/',
  '/index.html',
  '/weather-dashboard.css',
  '/weather-dashboard.js',
  '/weather-standalone-data.js',
  '/weather-live-config.js',
  '/weather-app-icon.svg',
  '/weather-manifest.webmanifest',
  '/vendor/weather-dashboard-base.css',
  '/vendor/weather-dashboard-typography.css',
  '/vendor/weather-dashboard-enhancements.js',
  '/vendor/weather-dashboard-legacy.js',
  '/vendor/weather-dashboard-air-quality.js',
  '/vendor/weather-dashboard-tide.js',
  '/vendor/weather-dashboard-observation-status.js',
  '/vendor/weather-dashboard-history-link.js',
  '/data/dashboard-data.json',
  '/data/nowcast.json',
  '/data/air-quality.json',
  '/data/tide.json'
];

self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE);
    await Promise.all(SHELL.map(async url=>{
      try{
        const response=await fetch(url,{cache:'reload'});
        if(response.ok)await cache.put(url,response.clone());
      }catch{}
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k.startsWith('jotrip-weather-shell-')&&k!==CACHE).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});

const timedFetch=async(request,ms)=>{
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),ms);
  try{return await fetch(request,{signal:controller.signal})}
  finally{clearTimeout(timer)}
};

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin)return;

  if(request.mode==='navigate'){
    event.respondWith((async()=>{
      try{
        const response=await timedFetch(request,2200);
        if(response.ok){
          const cache=await caches.open(CACHE);
          cache.put('/index.html',response.clone()).catch(()=>{});
          return response;
        }
      }catch{}
      return (await caches.match('/index.html'))||(await caches.match('/'))||Response.error();
    })());
    return;
  }

  if(url.pathname.startsWith('/data/')){
    event.respondWith((async()=>{
      const cache=await caches.open(CACHE);
      try{
        const response=await timedFetch(request,1600);
        if(response.ok){
          cache.put(url.pathname,response.clone()).catch(()=>{});
          return response;
        }
      }catch{}
      return (await cache.match(url.pathname,{ignoreSearch:true}))||Response.error();
    })());
    return;
  }

  if(url.pathname.startsWith('/vendor/')||SHELL.includes(url.pathname)){
    event.respondWith((async()=>{
      const cache=await caches.open(CACHE);
      const cached=await cache.match(url.pathname,{ignoreSearch:true});
      if(cached)return cached;
      const response=await fetch(request);
      if(response.ok)cache.put(url.pathname,response.clone()).catch(()=>{});
      return response;
    })());
  }
});
