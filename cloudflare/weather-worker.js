const ORIGINS=[
  'https://raw.githubusercontent.com/kenzuko/Jotrip-Lab/feat/weather-lab-data-engine-v1/weather',
  'https://raw.githubusercontent.com/kenzuko/Jotrip-Weather/main/data'
];
const ALLOWED=new Set(['dashboard-data.json','nowcast.json','air-quality.json','tide.json']);
const MAX_AGE={'dashboard-data.json':300,'nowcast.json':300,'air-quality.json':900,'tide.json':1800};
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
function stamp(data){
  const v=data?.generated_at||data?.sampled_time||data?.collected_at||null;
  const t=v?Date.parse(v):NaN;return Number.isFinite(t)?t:0;
}
async function fetchText(url,ms=2400){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),ms);
  try{
    const r=await fetch(url,{headers:{accept:'application/json'},signal:controller.signal,cf:{cacheTtl:0,cacheEverything:false}});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    const text=await r.text();const data=JSON.parse(text);
    return {text,data};
  }finally{clearTimeout(timer)}
}
export default {
  async fetch(request,env,ctx){
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
    if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:cors});
    const url=new URL(request.url);
    if(url.pathname==='/health')return Response.json({ok:true,service:'jotrip-weather-live'},{headers:{...cors,'cache-control':'no-store'}});
    const name=decodeURIComponent(url.pathname.replace(/^\/+/,''));
    if(!ALLOWED.has(name))return new Response('Not found',{status:404,headers:cors});

    const cache=caches.default;
    const cacheKey=new Request(`https://weather-cache.jotrip.local/${name}`,{method:'GET'});
    const cached=await cache.match(cacheKey);

    const refresh=async()=>{
      let best=null,lastError=null;
      for(const base of ORIGINS){
        try{
          const candidate=await fetchText(`${base}/${name}?t=${Date.now()}`);
          if(!valid(name,candidate.data))throw new Error('Invalid payload');
          if(!best||stamp(candidate.data)>stamp(best.data))best=candidate;
          if(base.includes('/Jotrip-Lab/'))break;
        }catch(e){lastError=e}
      }
      if(!best)throw lastError||new Error('No valid Weather origin');
      const ttl=MAX_AGE[name]||300;
      const response=new Response(best.text,{status:200,headers:{
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
      const headers=new Headers(cached.headers);Object.entries(cors).forEach(([k,v])=>headers.set(k,v));headers.set('x-jotrip-edge','HIT');
      return request.method==='HEAD'?new Response(null,{status:200,headers}):new Response(cached.body,{status:200,headers});
    }
    try{
      const response=await refresh();
      return request.method==='HEAD'?new Response(null,{status:200,headers:response.headers}):response;
    }catch{
      return Response.json({ok:false,error:'Weather origin temporarily unavailable'},{status:503,headers:{...cors,'cache-control':'no-store'}});
    }
  }
};
