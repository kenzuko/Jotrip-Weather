const ORIGIN='https://raw.githubusercontent.com/kenzuko/Jotrip-Lab/feat/weather-lab-data-engine-v1/weather';
const ALLOWED=new Set(['dashboard-data.json','nowcast.json','air-quality.json','tide.json']);
const MAX_AGE={
  'dashboard-data.json':300,
  'nowcast.json':300,
  'air-quality.json':900,
  'tide.json':1800
};

const cors={
  'access-control-allow-origin':'https://weather.openphuquoc.com',
  'access-control-allow-methods':'GET,HEAD,OPTIONS',
  'access-control-allow-headers':'accept,content-type',
  'vary':'Origin'
};

function valid(name,data){
  if(name==='dashboard-data.json')return data?.report_status==='LIVE'&&data?.points&&Object.keys(data.points).length>0;
  return data?.status==='POINT_NUMERIC_READY';
}

export default {
  async fetch(request,env,ctx){
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
    if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:cors});

    const url=new URL(request.url);
    if(url.pathname==='/health'){
      return Response.json({ok:true,service:'jotrip-weather-live'},{headers:{...cors,'cache-control':'no-store'}});
    }

    const name=decodeURIComponent(url.pathname.replace(/^\/+/,''));
    if(!ALLOWED.has(name))return new Response('Not found',{status:404,headers:cors});

    const cache=caches.default;
    const cacheKey=new Request(`https://weather-cache.jotrip.local/${name}`,{method:'GET'});
    const cached=await cache.match(cacheKey);

    const refresh=async()=>{
      const origin=`${ORIGIN}/${name}?t=${Date.now()}`;
      const upstream=await fetch(origin,{headers:{accept:'application/json'},cf:{cacheTtl:0,cacheEverything:false}});
      if(!upstream.ok)throw new Error(`Origin HTTP ${upstream.status}`);
      const text=await upstream.text();
      const data=JSON.parse(text);
      if(!valid(name,data))throw new Error('Invalid upstream payload');
      const ttl=MAX_AGE[name]||300;
      const response=new Response(text,{status:200,headers:{
        ...cors,
        'content-type':'application/json; charset=utf-8',
        'cache-control':`public, max-age=30, s-maxage=${ttl}, stale-while-revalidate=3600`,
        'x-jotrip-edge':'MISS'
      }});
      await cache.put(cacheKey,response.clone());
      return response;
    };

    if(cached){
      ctx.waitUntil(refresh().catch(()=>{}));
      const headers=new Headers(cached.headers);
      Object.entries(cors).forEach(([k,v])=>headers.set(k,v));
      headers.set('x-jotrip-edge','HIT');
      if(request.method==='HEAD')return new Response(null,{status:200,headers});
      return new Response(cached.body,{status:200,headers});
    }

    try{
      const response=await refresh();
      if(request.method==='HEAD')return new Response(null,{status:200,headers:response.headers});
      return response;
    }catch(error){
      return Response.json({ok:false,error:'Weather origin temporarily unavailable'},{status:503,headers:{...cors,'cache-control':'no-store'}});
    }
  }
};
