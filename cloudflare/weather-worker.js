const ORIGINS=[
  'https://raw.githubusercontent.com/kenzuko/Jotrip-Lab/feat/weather-lab-data-engine-v1/weather',
  'https://raw.githubusercontent.com/kenzuko/Jotrip-Weather/main/data'
];
const ALLOWED=new Set(['dashboard-data.json','nowcast.json','air-quality.json','tide.json']);
const MAX_AGE={'dashboard-data.json':300,'nowcast.json':300,'air-quality.json':900,'tide.json':1800};
const POINTS=new Set(['an_thoi','duong_dong','ganh_dau','rach_gia']);
const VERDICTS=new Set(['accurate','close','wrong']);
const RELATIONS=new Set(['lower','about','higher','unknown']);
const EVIDENCE=new Set(['on_sea','on_land','instrument','field_observation']);
const cors={
  'access-control-allow-origin':'https://weather.openphuquoc.com',
  'access-control-allow-methods':'GET,HEAD,POST,OPTIONS',
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
function cleanText(value,max=500){return typeof value==='string'?value.trim().slice(0,max):''}
function finiteOrNull(value){const n=Number(value);return Number.isFinite(n)?n:null}
const ISO_INSTANT=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;
function isoUTC7(value=Date.now()){
  const d=value instanceof Date?value:new Date(value);
  if(Number.isNaN(d.getTime()))return null;
  return new Date(d.getTime()+7*3600000).toISOString().replace('Z','+07:00');
}
function normalizeIsoString(value){
  if(typeof value!=='string'||!ISO_INSTANT.test(value))return value;
  return isoUTC7(value)||value;
}
function normalizeTimestamps(value){
  if(Array.isArray(value))return value.map(normalizeTimestamps);
  if(value&&typeof value==='object'){
    const out={};
    for(const [k,v] of Object.entries(value))out[k]=normalizeTimestamps(v);
    return out;
  }
  return normalizeIsoString(value);
}
function normalizeFeedback(payload){
  if(!payload||typeof payload!=='object')throw new Error('invalid_payload');
  const id=cleanText(payload.id,100);
  const pointId=cleanText(payload.point_id,40);
  const verdict=cleanText(payload.verdict,20);
  const wind=RELATIONS.has(payload.wind_relation)?payload.wind_relation:'unknown';
  const wave=RELATIONS.has(payload.wave_relation)?payload.wave_relation:'unknown';
  const rain=RELATIONS.has(payload.rain_relation)?payload.rain_relation:'unknown';
  const evidence=EVIDENCE.has(payload.evidence_type)?payload.evidence_type:'field_observation';
  if(!id||!POINTS.has(pointId)||!VERDICTS.has(verdict))throw new Error('invalid_feedback_fields');
  const observed=new Date(payload.observed_at||Date.now());
  if(Number.isNaN(observed.getTime()))throw new Error('invalid_observed_at');
  const now=Date.now();
  if(observed.getTime()>now+15*60*1000||observed.getTime()<now-7*24*60*60*1000)throw new Error('observed_at_out_of_range');
  const forecast=payload.forecast&&typeof payload.forecast==='object'?{
    temperature_c:finiteOrNull(payload.forecast.temperature_c),
    wind_kmh:finiteOrNull(payload.forecast.wind_kmh),
    gust_kmh:finiteOrNull(payload.forecast.gust_kmh),
    wave_hs_m:finiteOrNull(payload.forecast.wave_hs_m),
    wave_hmax_m:finiteOrNull(payload.forecast.wave_hmax_m),
    rain_3h_mm:finiteOrNull(payload.forecast.rain_3h_mm),
    current_kmh:finiteOrNull(payload.forecast.current_kmh)
  }:{};
  return {
    id,
    observed_at:isoUTC7(observed),
    point_id:pointId,
    point_name:cleanText(payload.point_name,80),
    verdict,
    wind_relation:wind,
    wave_relation:wave,
    rain_relation:rain,
    evidence_type:evidence,
    note:cleanText(payload.note,500),
    snapshot_id:cleanText(payload.snapshot_id,120),
    forecast_generated_at:normalizeIsoString(cleanText(payload.forecast_generated_at,80)),
    source_cycles:normalizeTimestamps(payload.source_cycles&&typeof payload.source_cycles==='object'?payload.source_cycles:{}),
    forecast,
    ui_version:cleanText(payload.ui_version,60),
    calibration_eligible:0
  };
}
async function fetchText(url,ms=2400){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),ms);
  try{
    const r=await fetch(url,{headers:{accept:'application/json'},signal:controller.signal,cf:{cacheTtl:0,cacheEverything:false}});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    const text=await r.text();const data=normalizeTimestamps(JSON.parse(text));
    return {text:JSON.stringify(data),data};
  }finally{clearTimeout(timer)}
}
async function storeFeedback(env,entry){
  if(!env.WEATHER_FEEDBACK)throw new Error('feedback_store_not_bound');
  const createdAt=isoUTC7();
  await env.WEATHER_FEEDBACK.prepare(`INSERT OR IGNORE INTO weather_feedback
    (id,created_at,observed_at,point_id,point_name,verdict,wind_relation,wave_relation,rain_relation,evidence_type,note,snapshot_id,forecast_generated_at,source_cycles_json,forecast_json,ui_version,calibration_eligible)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      entry.id,createdAt,entry.observed_at,entry.point_id,entry.point_name,entry.verdict,
      entry.wind_relation,entry.wave_relation,entry.rain_relation,entry.evidence_type,entry.note,
      entry.snapshot_id,entry.forecast_generated_at,JSON.stringify(entry.source_cycles),JSON.stringify(entry.forecast),
      entry.ui_version,entry.calibration_eligible
    ).run();
  return {ok:true,id:entry.id,stored_at:createdAt,calibration_eligible:false};
}
export default {
  async fetch(request,env,ctx){
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
    const url=new URL(request.url);
    if(url.pathname==='/health')return Response.json({ok:true,service:'jotrip-weather-live'},{headers:{...cors,'cache-control':'no-store'}});
    if(url.pathname==='/feedback/health'){
      return Response.json({ok:true,store:env.WEATHER_FEEDBACK?'D1_READY':'D1_NOT_BOUND'},{headers:{...cors,'cache-control':'no-store'}});
    }
    if(url.pathname==='/feedback'){
      if(request.method!=='POST')return new Response('Method not allowed',{status:405,headers:cors});
      try{
        const payload=await request.json();
        const entry=normalizeFeedback(payload);
        return Response.json(await storeFeedback(env,entry),{status:201,headers:{...cors,'cache-control':'no-store'}});
      }catch(error){
        const message=String(error?.message||error);
        const status=message==='feedback_store_not_bound'?503:400;
        return Response.json({ok:false,error:message},{status,headers:{...cors,'cache-control':'no-store'}});
      }
    }
    if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:cors});
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
