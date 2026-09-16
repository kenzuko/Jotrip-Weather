(()=>{
  const OWNER='kenzuko';
  const REPO='Jotrip-Lab';
  const REF='feat/weather-lab-data-engine-v1';
  const RAW=`https://raw.githubusercontent.com/${OWNER}/${REPO}/${REF}`;
  const API=`https://api.github.com/repos/${OWNER}/${REPO}/contents`;
  const CACHE_PREFIX='jotrip-weather-json:';
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

  const freshFor=path=>{
    if(path.endsWith('/nowcast.json'))return 2*60*1000;
    if(path.endsWith('/dashboard-data.json'))return 5*60*1000;
    if(path.endsWith('/air-quality.json'))return 10*60*1000;
    if(path.endsWith('/tide.json'))return 30*60*1000;
    return 5*60*1000;
  };

  const fallbackFor=path=>path.endsWith('/tide.json')?24*60*60*1000:6*60*60*1000;

  const readCache=path=>{
    try{
      const value=JSON.parse(localStorage.getItem(CACHE_PREFIX+path)||'null');
      if(!value||typeof value.body!=='string'||!Number.isFinite(value.savedAt))return null;
      return value;
    }catch{return null}
  };

  const writeCache=(path,body)=>{
    try{localStorage.setItem(CACHE_PREFIX+path,JSON.stringify({savedAt:Date.now(),body}))}catch{}
  };

  const jsonResponse=(body,source='cache')=>new Response(body,{status:200,headers:{
    'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store',
    'x-jotrip-source':source
  }});

  const fetchWithTimeout=async(url,init,timeoutMs=3500)=>{
    if(init?.signal)return nativeFetch(url,{...init,cache:'no-store'});
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{return await nativeFetch(url,{...init,cache:'no-store',signal:controller.signal})}
    finally{clearTimeout(timer)}
  };

  const viaRaw=async(path,init)=>{
    const target=`${RAW}${path}?t=${Date.now()}`;
    return fetchWithTimeout(target,init,3500);
  };

  const viaApi=async(path,init)=>{
    const target=`${API}${path}?ref=${encodeURIComponent(REF)}&t=${Date.now()}`;
    const headers=new Headers(init?.headers||{});
    if(!headers.has('Accept'))headers.set('Accept','application/vnd.github+json');
    const response=await fetchWithTimeout(target,{...init,headers},4500);
    if(!response.ok)return response;
    const meta=await response.json();
    if(meta?.type!=='file'||!meta?.content)return new Response('',{status:502,statusText:'Invalid GitHub content payload'});
    const text=decodeBase64Utf8(meta.content);
    return jsonResponse(text,'github-api');
  };

  const loadNetwork=async(path,init)=>{
    let primary=null;
    try{
      primary=await viaRaw(path,init);
      if(primary.ok){
        const body=await primary.text();
        writeCache(path,body);
        return jsonResponse(body,'github-raw');
      }
    }catch{}

    try{
      const fallback=await viaApi(path,init);
      if(fallback.ok){
        const body=await fallback.text();
        writeCache(path,body);
        return jsonResponse(body,'github-api');
      }
      if(primary)return primary;
      return fallback;
    }catch(error){
      if(primary)return primary;
      throw error;
    }
  };

  window.fetch=(input,init)=>{
    const path=weatherJsonPath(input);
    if(!path)return nativeFetch(input,init);

    const cached=readCache(path);
    const age=cached?Date.now()-cached.savedAt:Infinity;

    if(cached&&age<=freshFor(path)){
      loadNetwork(path,init).catch(()=>{});
      return Promise.resolve(jsonResponse(cached.body,'device-cache'));
    }

    return loadNetwork(path,init).catch(error=>{
      if(cached&&age<=fallbackFor(path))return jsonResponse(cached.body,'stale-device-cache');
      throw error;
    });
  };
})();
