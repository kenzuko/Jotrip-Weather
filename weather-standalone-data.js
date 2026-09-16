(()=>{
  const OWNER='kenzuko';
  const REPO='Jotrip-Lab';
  const REF='feat/weather-lab-data-engine-v1';
  const RAW=`https://raw.githubusercontent.com/${OWNER}/${REPO}/${REF}`;
  const API=`https://api.github.com/repos/${OWNER}/${REPO}/contents`;
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

  const viaRaw=async(path,init)=>{
    const target=`${RAW}${path}?t=${Date.now()}`;
    return nativeFetch(target,{...init,cache:'no-store'});
  };

  const viaApi=async(path,init)=>{
    const target=`${API}${path}?ref=${encodeURIComponent(REF)}&t=${Date.now()}`;
    const headers=new Headers(init?.headers||{});
    if(!headers.has('Accept'))headers.set('Accept','application/vnd.github+json');
    const response=await nativeFetch(target,{...init,headers,cache:'no-store'});
    if(!response.ok)return response;
    const meta=await response.json();
    if(meta?.type!=='file'||!meta?.content)return new Response('',{status:502,statusText:'Invalid GitHub content payload'});
    const text=decodeBase64Utf8(meta.content);
    return new Response(text,{status:200,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
  };

  window.fetch=async(input,init)=>{
    const path=weatherJsonPath(input);
    if(!path)return nativeFetch(input,init);
    let primary=null;
    try{
      primary=await viaRaw(path,init);
      if(primary.ok)return primary;
    }catch{}
    try{
      const fallback=await viaApi(path,init);
      if(fallback.ok)return fallback;
      return primary||fallback;
    }catch(err){
      if(primary)return primary;
      throw err;
    }
  };
})();
