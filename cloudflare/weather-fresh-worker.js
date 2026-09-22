// Independent, read-only live weather gateway. Does not change the existing feedback Worker.
// Ground Truth / PQ Local Now remain owned by Jotrip-Lab's data-weather branch.
const BASE="https://raw.githubusercontent.com/kenzuko/Jotrip-Lab/data-weather/data";
const FILES=Object.freeze({
  "local-now.json":"weather-groundtruth/local-now.json",
  "groundtruth.json":"weather-groundtruth/latest.json",
  "current-bundle.json":"weather-current/latest.json",
  "nowcast-compact.json":"weather-nowcast/compact-latest.json"
});
const AGE_MS=60_000;
const CORS={
  "access-control-allow-origin":"https://weather.openphuquoc.com",
  "access-control-allow-methods":"GET,HEAD,OPTIONS",
  "access-control-allow-headers":"accept,content-type",
  "vary":"Origin"
};
const stamp=v=>{const n=Date.parse(v||"");return Number.isFinite(n)?n:0;};
function sourceTime(name,p){
  if(name==="nowcast-compact.json")return p.sampled_time||p.generated_at||null;
  return p.generated_at||null;
}
function valid(name,p){
  if(!p||typeof p!=="object"||!stamp(p.generated_at))return false;
  if(name==="local-now.json")return p.engine==="PQ_LOCAL_NOW_V2"&&p.data_class==="ESTIMATED_NOW"&&p.points&&Object.keys(p.points).length>0;
  if(name==="groundtruth.json")return p.atmosphere&&p.rainfall&&p.actual_policy;
  if(name==="current-bundle.json")return p.local_now&&p.groundtruth;
  return p.status==="POINT_NUMERIC_READY"&&p.points&&Object.keys(p.points).length>0;
}
async function origin(name){
  const res=await fetch(BASE+"/"+FILES[name]+"?t="+Date.now(),{
    headers:{accept:"application/json"},cf:{cacheTtl:0,cacheEverything:false}
  });
  if(!res.ok)throw Error("weather-origin-"+res.status);
  const payload=await res.json();
  if(!valid(name,payload))throw Error("weather-source-invalid");
  const at=sourceTime(name,payload);
  return new Response(JSON.stringify(payload),{
    headers:{
      ...CORS,
      "content-type":"application/json; charset=utf-8",
      "cache-control":"public,max-age=15,s-maxage=60",
      "x-jotrip-source-at":at||"",
      "x-jotrip-fetched-at":new Date().toISOString()
    }
  });
}
function result(response,edge,head=false){
  const h=new Headers(response.headers);
  Object.entries(CORS).forEach(([k,v])=>h.set(k,v));
  h.set("x-jotrip-edge",edge);
  const observed=stamp(h.get("x-jotrip-source-at"));
  h.set("x-jotrip-source-age-min",observed?String(Math.max(0,Math.round((Date.now()-observed)/60000))):"unknown");
  return new Response(head?null:response.body,{status:response.status,headers:h});
}
export default {
  async fetch(request,env,ctx){
    if(request.method==="OPTIONS")return new Response(null,{status:204,headers:CORS});
    const url=new URL(request.url);
    if(url.pathname==="/health"){
      return Response.json({
        ok:true,service:"jotrip-weather-fresh",
        cron_configured:Boolean(env.GITHUB_WEATHER_DISPATCH_TOKEN),
        expected_cadence_minutes:10
      },{headers:{...CORS,"cache-control":"no-store"}});
    }
    if(!["GET","HEAD"].includes(request.method))return new Response("Method not allowed",{status:405,headers:CORS});
    const name=url.pathname.replace(/^\/+|\/+$/g,"");
    if(!Object.hasOwn(FILES,name))return new Response("Not found",{status:404,headers:CORS});
    const cache=caches.default;
    const key=new Request("https://jotrip-weather-fresh.internal/"+name);
    const cached=await cache.match(key);
    const fetched=stamp(cached?.headers.get("x-jotrip-fetched-at"));
    if(cached&&Date.now()-fetched<AGE_MS)return result(cached,"HIT",request.method==="HEAD");
    try {
      const fresh=await origin(name);
      ctx.waitUntil(cache.put(key,fresh.clone()));
      return result(fresh,"MISS",request.method==="HEAD");
    } catch(err) {
      // An old payload is explicitly marked stale, never called live.
      if(cached&&Date.now()-fetched<30*60_000){
        const response=result(cached,"STALE",request.method==="HEAD");
        response.headers.set("x-jotrip-source-stale","true");
        response.headers.set("cache-control","no-store");
        return response;
      }
      return Response.json({ok:false,error:"live-source-unavailable"},{
        status:503,headers:{...CORS,"cache-control":"no-store"}
      });
    }
  },
  async scheduled(event,env,ctx){
    if(!env.GITHUB_WEATHER_DISPATCH_TOKEN){
      console.error("Weather cron: dispatch token missing");
      return;
    }
    const dispatch=async (file,workflow,thresholdMinutes)=>{
      try {
        const payload=await (await origin(file)).json();
        const generated=stamp(payload.generated_at);
        const ageMinutes=generated?(Date.now()-generated)/60000:Infinity;
        if(ageMinutes<thresholdMinutes){
          console.log("Weather cron healthy",file,Math.round(ageMinutes)+"m");
          return;
        }
        // Only restart a writer when its last *pipeline run* is overdue.
        // Satellite observation time can legitimately lag the collection time.
        const root="https://api.github.com/repos/kenzuko/Jotrip-Lab/actions/workflows/"+workflow;
        const githubHeaders={
          authorization:"Bearer "+env.GITHUB_WEATHER_DISPATCH_TOKEN,
          accept:"application/vnd.github+json",
          "x-github-api-version":"2022-11-28",
          "user-agent":"jotrip-weather-fresh-cron"
        };
        // A slow NOAA ingestion must finish before another run can be queued.
        // Query actual run state rather than assuming a missing publish means idle.
        const runsResponse=await fetch(root+"/runs?per_page=12",{headers:githubHeaders});
        if(!runsResponse.ok)throw Error(workflow+" status HTTP "+runsResponse.status);
        const runs=await runsResponse.json();
        const active=(runs.workflow_runs||[]).find(run=>run.status!=="completed");
        if(active){
          console.log("Weather cron writer already running",workflow,active.id);
          return;
        }
        const api=root+"/dispatches";
        const r=await fetch(api,{
          method:"POST",
          headers:githubHeaders,
          body:JSON.stringify({ref:"main"})
        });
        if(r.status!==204)throw Error(workflow+" HTTP "+r.status);
        console.log("Weather cron dispatched",workflow,Math.round(ageMinutes)+"m old");
      }catch(error){
        console.error("Weather cron check failed",file,String(error));
      }
    };
    await Promise.all([
      dispatch("local-now.json","weather-live-groundtruth-schedule.yml",8),
      dispatch("nowcast-compact.json","weather-live-himawari-schedule.yml",19)
    ]);
  }
};
