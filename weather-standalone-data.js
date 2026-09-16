(()=>{
  const OWNER='kenzuko';
  const REPO='Jotrip-Lab';
  const REF='feat/weather-lab-data-engine-v1';
  const RAW=`https://raw.githubusercontent.com/${OWNER}/${REPO}/${REF}`;
  const API=`https://api.github.com/repos/${OWNER}/${REPO}/contents`;
  const LIVE_API=(window.JOTRIP_WEATHER_LIVE_API_URL||'').replace(/\/$/,'');
  const BOOTSTRAP=window.JOTRIP_WEATHER_BOOTSTRAP||null;
  const CACHE_PREFIX='jotrip-weather-json:v3:';
  const nativeFetch=window.fetch.bind(window);

  const decodeBase64Utf8=value=>{
    const raw=atob(String(value||'').replace(/\s+/g,''));
    const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  };
  const weatherJsonPath=input=>{
    const original=typeof input==='string'?input:(input&&input.url)||'';
    if(!original)return null;
    let url;try{url=new URL(original,location.href)}catch{return null}
    if(url.origin!==location.origin||!url.pathname.startsWith('/weather/')||!url.pathname.endsWith('.json'))return null;
    return url.pathname;
  };
  const fileName=path=>path.split('/').filter(Boolean).pop();
  const payloadTime=data=>{
    const value=data?.generated_at||data?.sampled_time||data?.collected_at||null;
    const t=value?Date.parse(value):NaN;return Number.isFinite(t)?t:null;
  };
  const parseValid=(path,body)=>{
    try{
      const data=typeof body==='string'?JSON.parse(body):body;
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
      if(!value||typeof value.body!=='string'||!Number.isFinite(value.savedAt)||!parseValid(path,value.body))return null;
      return value;
    }catch{return null}
  };
  const writeCache=(path,body)=>{
    if(!parseValid(path,body))return false;
    try{localStorage.setItem(CACHE_PREFIX+path,JSON.stringify({savedAt:Date.now(),body}));return true}catch{return false}
  };
  const jsonResponse=(body,source='cache',stale=false)=>new Response(body,{status:200,headers:{
    'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-jotrip-source':source,'x-jotrip-stale':stale?'1':'0'
  }});
  const bootstrapCandidate=path=>{
    if(!path.endsWith('/dashboard-data.json')||!parseValid(path,BOOTSTRAP))return null;
    return {savedAt:payloadTime(BOOTSTRAP)||0,body:JSON.stringify(BOOTSTRAP),source:'embedded-last-good'};
  };
  const newerCandidate=(a,b,path)=>{
    if(!a)return b;if(!b)return a;
    const ta=payloadTime(parseValid(path,a.body))||0,tb=payloadTime(parseValid(path,b.body))||0;
    return tb>ta?b:a;
  };
  const fetchWithTimeout=async(url,init,timeoutMs)=>{
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{return await nativeFetch(url,{...init,cache:'no-store',signal:controller.signal})}finally{clearTimeout(timer)}
  };
  const acceptBody=(path,body,current,source)=>{
    const incoming=parseValid(path,body);if(!incoming)throw new Error(`${source}: invalid Weather payload`);
    const currentData=current?parseValid(path,current.body):null;
    const incomingTime=payloadTime(incoming),currentTime=payloadTime(currentData);
    if(incomingTime&&currentTime&&incomingTime<currentTime)return jsonResponse(current.body,current.source||'last-good-newer',false);
    writeCache(path,body);return jsonResponse(body,source,false);
  };
  const viaWorker=async(path,init,current)=>{
    if(!LIVE_API)throw new Error('Weather Worker chưa cấu hình');
    const r=await fetchWithTimeout(`${LIVE_API}/${encodeURIComponent(fileName(path))}?t=${Date.now()}`,{...init,headers:{...(init?.headers||{}),accept:'application/json'}},1800);
    if(!r.ok)throw new Error(`worker HTTP ${r.status}`);return acceptBody(path,await r.text(),current,'cloudflare-worker');
  };
  const viaMirror=async(path,init,current)=>{
    const r=await fetchWithTimeout(`/data/${encodeURIComponent(fileName(path))}?t=${Date.now()}`,init,2800);
    if(!r.ok)throw new Error(`mirror HTTP ${r.status}`);return acceptBody(path,await r.text(),current,'same-origin-mirror');
  };
  const viaRaw=async(path,init,current)=>{
    const r=await fetchWithTimeout(`${RAW}${path}?t=${Date.now()}`,init,3500);
    if(!r.ok)throw new Error(`raw HTTP ${r.status}`);return acceptBody(path,await r.text(),current,'github-raw');
  };
  const viaApi=async(path,init,current)=>{
    const headers=new Headers(init?.headers||{});if(!headers.has('Accept'))headers.set('Accept','application/vnd.github+json');
    const r=await fetchWithTimeout(`${API}${path}?ref=${encodeURIComponent(REF)}&t=${Date.now()}`,{...init,headers},4500);
    if(!r.ok)throw new Error(`api HTTP ${r.status}`);const meta=await r.json();
    if(meta?.type!=='file'||!meta?.content)throw new Error('Invalid GitHub content payload');
    return acceptBody(path,decodeBase64Utf8(meta.content),current,'github-api');
  };
  const refreshBest=async(path,init,current)=>{
    const fast=[];if(LIVE_API)fast.push(viaWorker(path,init,current));fast.push(viaMirror(path,init,current));
    try{return await Promise.any(fast)}catch{}
    try{return await viaRaw(path,init,current)}catch{}
    return viaApi(path,init,current);
  };

  window.fetch=(input,init)=>{
    const path=weatherJsonPath(input);if(!path)return nativeFetch(input,init);
    const cached=readCache(path);const boot=bootstrapCandidate(path);const current=newerCandidate(cached,boot,path);
    if(current){
      refreshBest(path,init,current).catch(()=>{});
      const data=parseValid(path,current.body);const age=payloadTime(data)?Date.now()-payloadTime(data):Infinity;
      const staleLimit=path.endsWith('/dashboard-data.json')?12*60*60*1000:6*60*60*1000;
      return Promise.resolve(jsonResponse(current.body,current.source||'last-good',age>staleLimit));
    }
    return refreshBest(path,init,null);
  };
})();
