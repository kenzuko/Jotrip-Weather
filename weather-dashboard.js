(()=>{
  const V="20260916-local-1";
  const BASE="/vendor";
  const REFRESH_MS=10*60*1000;
  const url=path=>`${BASE}${path}?v=${V}`;

  const preload=(path,as)=>{
    const l=document.createElement('link');
    l.rel='preload';
    l.as=as;
    l.href=url(path);
    document.head.appendChild(l);
  };

  preload('/weather-dashboard-typography.css','style');
  [
    '/weather-dashboard-enhancements.js',
    '/weather-dashboard-legacy.js',
    '/weather-dashboard-air-quality.js',
    '/weather-dashboard-tide.js',
    '/weather-dashboard-observation-status.js',
    '/weather-dashboard-history-link.js'
  ].forEach(src=>preload(src,'script'));

  const style=href=>{
    const l=document.createElement("link");
    l.rel="stylesheet";
    l.href=url(href);
    l.onerror=()=>console.warn(`Không tải được ${href}`);
    document.head.appendChild(l);
  };

  const loadScript=src=>new Promise((ok,fail)=>{
    const s=document.createElement("script");
    s.src=url(src);
    s.async=false;
    s.onload=ok;
    s.onerror=()=>fail(new Error(`Không tải được ${src}`));
    document.head.appendChild(s);
  });

  const warn=(label,err)=>console.warn(`[Weather Lab] Bỏ qua mô-đun ${label}:`,err);
  const optional=async(src,label,install)=>{
    try{await loadScript(src);await install?.();}catch(err){warn(label,err)}
  };
  const fatal=err=>{
    console.error(err);
    document.body?.insertAdjacentHTML("afterbegin",'<div style="padding:12px;background:#fff1f2;color:#9b3f46">Không tải được phần hiển thị cốt lõi của Weather Lab. Hãy thử lại sau ít phút.</div>');
  };

  let lastRefreshAt=Date.now();
  let refreshing=false;

  const refreshData=async(force=false)=>{
    if(refreshing)return;
    if(document.visibilityState==='hidden'&&!force)return;
    if(!force&&Date.now()-lastRefreshAt<REFRESH_MS)return;
    if(typeof window.load!=='function')return;
    refreshing=true;
    try{
      await window.load();
      lastRefreshAt=Date.now();
    }catch(err){
      console.warn('[Weather Lab] Refresh nền thất bại, giữ nguyên dữ liệu đang hiển thị.',err);
    }finally{refreshing=false}
  };

  const scheduleRefresh=()=>{
    setInterval(()=>refreshData(false),60*1000);
    document.addEventListener('visibilitychange',()=>{
      if(document.visibilityState==='visible'&&Date.now()-lastRefreshAt>=REFRESH_MS)refreshData(true);
    });
    window.addEventListener('pageshow',event=>{
      if(event.persisted&&Date.now()-lastRefreshAt>=REFRESH_MS)refreshData(true);
    });
  };

  async function boot(){
    style("/weather-dashboard-typography.css");
    try{
      await loadScript("/weather-dashboard-enhancements.js");
      await loadScript("/weather-dashboard-legacy.js");
      await window.WeatherLabEnhancements?.afterLegacy?.();
    }catch(err){fatal(err);return}

    await Promise.all([
      optional("/weather-dashboard-air-quality.js","chất lượng không khí",()=>window.WeatherLabAirQuality?.install?.()),
      optional("/weather-dashboard-tide.js","thủy triều",()=>window.WeatherLabTide?.install?.()),
      optional("/weather-dashboard-observation-status.js","trạng thái quan sát",()=>window.WeatherLabObservationStatus?.install?.())
    ]);
    await optional("/weather-dashboard-history-link.js","lịch sử và đối chiếu",()=>window.WeatherLabHistoryLink?.install?.());
    lastRefreshAt=Date.now();
    scheduleRefresh();
  }
  boot();
})();
