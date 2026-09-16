(()=>{
  const OWNER='kenzuko';
  const REPO='Jotrip-Lab';
  const REF='feat/weather-lab-data-engine-v1';
  const RAW=`https://raw.githubusercontent.com/${OWNER}/${REPO}/${REF}`;
  const API=`https://api.github.com/repos/${OWNER}/${REPO}/contents`;
  const LIVE_API=(window.JOTRIP_WEATHER_LIVE_API_URL||'').replace(/\/$/,'');
  const CACHE_PREFIX='jotrip-weather-json:v2:';
  const nativeFetch=window.fetch.bind(window);

  const decodeBase64Utf8=value=>{
    const raw=atob(String(value||'').replace(/\s+/g,''));
    const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  };

  const weatherJsonPath=input=>{
    const original=typeof input==='string'?input:(input&&input.url)||'';
    if(!original)return null;
    let url;
    try{url=new URL(original,location.href)}catch{return null}
    if(url.origin!==location.origin)return null;
    if(!url.pathname.startsWith('/weather/')||!url.pathname.endsWith('.json'))return null;
    return url.pathname;
  };

  const fileName=path=>path.split('/').filter(Boolean).pop();

  const freshFor=path=>{
    if(path.endsWith('/dashboard-data.json'))return 10*60*1000;
    if(path.endsWith('/nowcast.json'))return 10*60*1000;
    if(path.endsWith('/air-quality.json'))return 30*60*1000;
    if(path.endsWith('/tide.json'))return 60*60*1000;
    return 10*60*1000;
  };

  const fallbackFor=path=>{
    if(path.endsWith('/dashboard-data.json'))return 2*60*60*1000;
    if(path.endsWith('/nowcast.json'))return 90*60*1000;
    if(path.endsWith('/air-quality.json'))return 6*60*60*1000;
    if(path.endsWith('/tide.json'))return 24*60*60*1000;
    return 2*60*60*1000;
  };

  const payloadTime=data=>{
    const value=data?.generated_at||data?.sampled_time||data?.collected_at||null;
    const t=value?Date.parse(value):NaN;
    return Number.isFinite(t)?t:null;
  };

  const parseValid=(path,body)=>{
    try{
      const data=JSON.parse(body);
      if(path.endsWith('/dashboard-data.json')){
        if(data?.report_status!=='LIVE'||!data?.points||typeof data.points!=='object'||!Object.keys(data.points).length)return null;
      }else if(['nowcast.json','air-quality.json','tide.json'].includes(fileName(path))){
        if(data?.status!=='POINT_NUMERIC_READY')return null;
      }
      return data;
    }catch{return null}
  };

  const readCache=path=>{
    try{
      const value=JSON.parse(localStorage.getItem(CACHE_PREFIX+path)||'null');
      if(!value||typeof value.body!=='string'||!Number.isFinite(value.savedAt))return null;
      if(!parseValid(path,value.body))return null;
      return value;
    }catch{return null}
  };

  const writeCache=(path,body)=>{
    if(!parseValid(path,body))return false;
    try{localStorage.setItem(CACHE_PREFIX+path,JSON.stringify({savedAt:Date.now(),body}));return true}catch{return false}
  };

  const jsonResponse=(body,source='cache',stale=false)=>new Response(body,{status:200,headers:{
    'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store',
    'x-jotrip-source':source,
    'x-jotrip-stale':stale?'1':'0'
  }});

  const fetchWithTimeout=async(url,init,timeoutMs)=>{
    if(init?.signal)return nativeFetch(url,{...init,cache:'no-store'});
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{return await nativeFetch(url,{...init,cache:'no-store',signal:controller.signal})}
    finally{clearTimeout(timer)}
  };

  const acceptBody=(path,body,cached,source)=>{
    const incoming=parseValid(path,body);
    if(!incoming)throw new Error(`${source}: invalid Weather payload`);
    if(cached){
      const current=parseValid(path,cached.body);
      const incomingTime=payloadTime(incoming),currentTime=payloadTime(current);
      if(incomingTime&&currentTime&&incomingTime<currentTime){
        return jsonResponse(cached.body,'device-cache-newer-than-origin',false);
      }
    }
    writeCache(path,body);
    return jsonResponse(body,source,false);
  };

  const viaWorker=async(path,init,cached)=>{
    if(!LIVE_API)throw new Error('Weather Worker chưa cấu hình');
    const target=`${LIVE_API}/${encodeURIComponent(fileName(path))}?t=${Date.now()}`;
    const response=await fetchWithTimeout(target,{...init,headers:{...(init?.headers||{}),accept:'application/json'}},1400);
    if(!response.ok)throw new Error(`worker HTTP ${response.status}`);
    return acceptBody(path,await response.text(),cached,'cloudflare-worker');
  };

  const viaMirror=async(path,init,cached)=>{
    const target=`/data/${encodeURIComponent(fileName(path))}?t=${Date.now()}`;
    const response=await fetchWithTimeout(target,init,1800);
    if(!response.ok)throw new Error(`mirror HTTP ${response.status}`);
    return acceptBody(path,await response.text(),cached,'same-origin-mirror');
  };

  const viaRaw=async(path,init,cached)=>{
    const target=`${RAW}${path}?t=${Date.now()}`;
    const response=await fetchWithTimeout(target,init,2800);
    if(!response.ok)throw new Error(`raw HTTP ${response.status}`);
    return acceptBody(path,await response.text(),cached,'github-raw');
  };

  const viaApi=async(path,init,cached)=>{
    const target=`${API}${path}?ref=${encodeURIComponent(REF)}&t=${Date.now()}`;
    const headers=new Headers(init?.headers||{});
    if(!headers.has('Accept'))headers.set('Accept','application/vnd.github+json');
    const response=await fetchWithTimeout(target,{...init,headers},3600);
    if(!response.ok)throw new Error(`api HTTP ${response.status}`);
    const meta=await response.json();
    if(meta?.type!=='file'||!meta?.content)throw new Error('Invalid GitHub content payload');
    return acceptBody(path,decodeBase64Utf8(meta.content),cached,'github-api');
  };

  const refreshBest=async(path,init,cached)=>{
    const attempts=[];
    if(LIVE_API)attempts.push(()=>viaWorker(path,init,cached));
    attempts.push(()=>viaMirror(path,init,cached),()=>viaRaw(path,init,cached),()=>viaApi(path,init,cached));
    let lastError=null;
    for(const attempt of attempts){
      try{return await attempt()}catch(error){lastError=error}
    }
    throw lastError||new Error('Weather data unavailable');
  };

  window.fetch=(input,init)=>{
    const path=weatherJsonPath(input);
    if(!path)return nativeFetch(input,init);

    const cached=readCache(path);
    const cacheAge=cached?Date.now()-cached.savedAt:Infinity;

    if(cached&&cacheAge<=freshFor(path)){
      refreshBest(path,init,cached).catch(()=>{});
      return Promise.resolve(jsonResponse(cached.body,'device-cache',false));
    }

    return refreshBest(path,init,cached).catch(error=>{
      if(cached&&cacheAge<=fallbackFor(path))return jsonResponse(cached.body,'last-good-device-cache',true);
      throw error;
    });
  };
})();
