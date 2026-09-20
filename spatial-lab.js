(function(){
"use strict";

const URLS={
  production:[
    "/weather/dashboard-data.json",
    "./data/dashboard-data.json",
    "https://raw.githubusercontent.com/kenzuko/Jotrip-Weather/main/data/dashboard-data.json",
    "https://raw.githubusercontent.com/kenzuko/Jotrip-Lab/feat/weather-lab-data-engine-v1/weather/dashboard-data.json"
  ],
  ecmwf:["./spatial-ecmwf.json","/weather/spatial-ecmwf.json","https://raw.githubusercontent.com/kenzuko/Jotrip-Lab/feat/weather-lab-data-engine-v1/weather/spatial-ecmwf.json"],
  icon:["./spatial-icon.json","/weather/spatial-icon.json","https://raw.githubusercontent.com/kenzuko/Jotrip-Lab/feat/weather-lab-data-engine-v1/weather/spatial-icon.json"],
  marine:["./spatial-marine.json","/weather/spatial-marine.json","https://raw.githubusercontent.com/kenzuko/Jotrip-Lab/feat/weather-lab-data-engine-v1/weather/spatial-marine.json"],
  gefs:["./data/weather-ensemble/spatial.json","/data/weather-ensemble/spatial.json","https://raw.githubusercontent.com/kenzuko/Jotrip-Lab/data-weather/data/weather-ensemble/spatial.json"],
  nowcast:["./data/weather-nowcast/latest.json","/data/weather-nowcast/latest.json","https://raw.githubusercontent.com/kenzuko/Jotrip-Lab/data-weather/data/weather-nowcast/latest.json"],
  critical:["./data/critical.json","/weather/critical.json","https://raw.githubusercontent.com/kenzuko/Jotrip-Lab/gh-pages/weather/data/critical.json"],
  forecast:["./jotrip-forecast.json","/weather/jotrip-forecast.json","https://raw.githubusercontent.com/kenzuko/Jotrip-Lab/gh-pages/weather/jotrip-forecast.json"],
  current:["https://raw.githubusercontent.com/kenzuko/Jotrip-Lab/data-weather/data/weather-current/latest.json"],
  feedback:["/feedback/recent?minutes=90&limit=30"]
};

const POINTS={
  duong_dong:{lat:10.2172,lon:103.9593,name:"Dương Đông",region:"central_west"},
  cua_can:{lat:10.292693,lon:103.914799,name:"Cửa Cạn",region:"north_northwest"},
  ganh_dau:{lat:10.37077,lon:103.84472,name:"Gành Dầu",region:"north_northwest"},
  bai_thom:{lat:10.411765,lon:104.031055,name:"Bãi Thơm",region:"east_northeast"},
  ham_ninh:{lat:10.18062,lon:104.04463,name:"Hàm Ninh",region:"east_northeast"},
  bai_sao:{lat:10.0572576,lon:104.0363948,name:"Bãi Sao",region:"south_southeast"},
  an_thoi:{lat:9.905,lon:104.005,name:"Biển An Thới",region:"south_southeast"}
};

const state={
  map:null,
  production:null,
  ecmwf:null,
  icon:null,
  marine:null,
  gefs:null,
  nowcast:null,
  critical:null,
  forecast:null,
  currentBundle:null,
  fieldFeedback:null,
  layer:"wind",
  frameIndex:0,
  selected:{lat:10.2172,lon:103.9593,anchor:"duong_dong"},
  crosshair:true,
  ensemble:false,
  modelDiff:false,
  risk:true,
  actual:false,
  riskLayer:null,
  actualLayer:null,
  flagMarker:null,
  radarLayers:[],
  radarMeta:null,
  radarIndex:0,
  timer:null,
  particles:[],
  particleRows:null,
  particleRAF:null,
  cloudTween:0,
  currentRows:null,
  currentFrame:null,
  loading:false
};

const $=id=>document.getElementById(id);
const num=v=>v===null||v===undefined||v===""||Number.isNaN(Number(v))?null:Number(v);
const validRange=(v,min,max)=>{
  const n=num(v);
  if(n===null||!Number.isFinite(n)||Math.abs(n)>=9000)return null;
  if(min!==undefined&&n<min)return null;
  if(max!==undefined&&n>max)return null;
  return n;
};
const validWaveHs=v=>validRange(v,0,30);
const validWaveDir=v=>validRange(v,0,360);
const validWavePeriod=v=>validRange(v,0,60);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const fmt=(v,d=1)=>{v=num(v);return v===null?"Chưa có":Number(v.toFixed(d)).toString()};
const COMPASS16=[
  "Bắc","Bắc Đông Bắc","Đông Bắc","Đông Đông Bắc",
  "Đông","Đông Đông Nam","Đông Nam","Nam Đông Nam",
  "Nam","Nam Tây Nam","Tây Nam","Tây Tây Nam",
  "Tây","Tây Tây Bắc","Tây Bắc","Bắc Tây Bắc"
];
function directionText(deg){
  const d=validRange(deg,0,360);
  if(d===null)return "Chưa rõ hướng";
  return COMPASS16[Math.round(d/22.5)%16];
}
function directionWithDegrees(deg){
  const d=validRange(deg,0,360);
  if(d===null)return "Chưa rõ hướng";
  return directionText(d)+" ("+Math.round(d)+"°)";
}
function productionPointAt(anchor,targetTime=activeValidTime()){
  const p=state.production?.points?.[anchor];
  if(!p)return null;
  const rows=p.hours||[];
  let hour=null,dist=Infinity;
  for(const r of rows){
    const t=Date.parse(r.time_iso||"");
    if(!Number.isFinite(t))continue;
    const d=Math.abs(t-(Number.isFinite(targetTime)?targetTime:Date.now()));
    if(d<dist){dist=d;hour=r}
  }
  return {point:p,hour};
}
function productionMetric(anchor,key,targetTime=activeValidTime()){
  const prod=productionPointAt(anchor,targetTime);
  if(!prod)return null;
  if(prod.hour&&prod.hour[key]!==null&&prod.hour[key]!==undefined)return num(prod.hour[key]);
  const map={wind:"wind",gust:"gust",rain:"rain",wave:"wave",period:"period",current:"current"};
  const k=map[key]||key;
  return num(prod.point?.[k]);
}
function windDisagreement(control,ens){
  const c=num(control),q=num(ens?.wind?.q50);
  if(c===null||q===null)return {level:"unknown",delta:null};
  const delta=Math.abs(q-c);
  const ratio=c>1?Math.max(q,c)/Math.max(1,Math.min(q,c)):delta;
  if(delta>=10||(delta>=6&&ratio>=1.8))return {level:"strong",delta};
  if(delta>=6)return {level:"moderate",delta};
  return {level:"low",delta};
}
function disagreementLabel(level){
  return level==="strong"?"BẤT ĐỒNG MẠNH":level==="moderate"?"BẤT ĐỒNG":"TƯƠNG ĐỐI ĐỒNG THUẬN";
}
const esc=v=>String(v??"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
const EMBED=new URLSearchParams(location.search).get("embed")==="1";
function haversineKm(lat1,lon1,lat2,lon2){
  const R=6371.0088,toRad=x=>x*Math.PI/180;
  const p1=toRad(lat1),p2=toRad(lat2),dp=toRad(lat2-lat1),dl=toRad(lon2-lon1);
  const a=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}
function feedbackCategory(note=""){
  const m=String(note).match(/category=([A-Z_]+)/);
  return m?m[1]:null;
}

async function fetchJSON(url){
  const sep=url.includes("?")?"&":"?";
  const r=await fetch(url+sep+"t="+Date.now(),{cache:"no-store"});
  if(!r.ok)throw new Error("HTTP "+r.status+" "+url);
  return r.json();
}
async function fetchFirst(urls){
  let last=null;
  for(const u of urls){
    try{return await fetchJSON(u)}catch(e){last=e}
  }
  throw last||new Error("No source");
}
async function optional(urls){
  try{return await fetchFirst(urls)}catch(e){console.warn("[V5 optional]",e);return null}
}

function overlayCurrentBundle(critical,bundle){
  if(!critical||!bundle)return critical;
  const local=bundle.local_now||{},ground=bundle.groundtruth||{},nowcast=bundle.nowcast||{};
  if(local.points){
    critical.local_generated_at=local.generated_at||critical.local_generated_at;
    Object.entries(local.points).forEach(([id,lp])=>{
      const p=critical.points?.[id];if(!p)return;
      const rain=lp.rain||{},wind=lp.wind||{},temp=lp.temperature||{},marine=lp.marine||{};
      p.local={...(p.local||{}),
        temperature_c:num(lp.temperature_c),
        wind_kmh:num(lp.wind_kmh),
        wind_direction_deg:num(lp.wind_direction_deg),
        rain_rate_mm_h:num(rain.rain_rate_mm_h),
        rain_confidence:num(rain.confidence),
        rain_imminence_score:num(rain.imminence?.score),
        rain_imminence_level:rain.imminence?.level||null,
        rain_impact_label:rain.imminence?.rain_impact_label||rain.rain_impact_label||null,
        wave_hs_m:num(lp.wave_hs_m),
        data_class:rain.data_class||p.local?.data_class,
        wind_class:wind.data_class||p.local?.wind_class,
        rain_class:rain.data_class||p.local?.rain_class,
        analysis_time:lp.analysis_time||local.generated_at||null
      };
    });
  }
  if(nowcast.points){
    state.nowcast=nowcast;
    Object.entries(nowcast.points).forEach(([id,np])=>{
      if(!critical.points?.[id])return;
      critical.points[id].nowcast={...(critical.points[id].nowcast||{}),
        convective_score:num(np.score??np.convective_signal?.score),
        cloud_top_cold_c:num(np.cold_cloud_top_temp_c??np.regional_cold_cloud_top_temp_c),
        cloud_top_high_m:num(np.high_cloud_top_height_m??np.regional_high_cloud_top_height_m),
        cooling_c_per_20m:num(np.cooling_c_per_20m_proxy),
        cloud_motion:np.cloud_motion||critical.points[id].nowcast?.cloud_motion||null
      };
    });
  }
  const actual=critical.actual={...(critical.actual||{})};
  const v=ground.atmosphere?.vvpq||{};
  if(v.status){
    actual.vvpq={
      status:v.status,observed_at:v.observed_at,
      temperature_c:num(v.temperature_c),wind_kmh:num(v.wind_speed_kmh),
      wind_direction_deg:num(v.wind_direction_deg),weather:v.weather||null
    };
  }
  const stations=ground.rainfall?.stations||{};
  if(Object.keys(stations).length){
    actual.rain_gauges=Object.values(stations).map(g=>({
      name:g.station_name,lat:num(g.lat),lon:num(g.lon),
      accum_mm:num(g.accumulation_mm),increment_mm:num(g.increment_mm),
      increment_min:num(g.increment_window_minutes),rain_observed:g.rain_observed,
      rain_intensity_mm_h:num(g.rain_intensity_mm_h),observed_at:g.observed_at,qc:g.qc
    }));
  }
  return critical;
}
function localMetric(anchor,key){
  const p=state.critical?.points?.[anchor]||{},l=p.local||{},m=p.model||{};
  const map={
    wind:l.wind_kmh,wind_direction:l.wind_direction_deg,rain:l.rain_rate_mm_h,
    wave:l.wave_hs_m??m.wave_hs_m,gust:m.gust_kmh,current:m.current_kmh
  };
  return num(map[key]);
}
function freshFieldReports(minutes=90){
  const cutoff=Date.now()-minutes*60000;
  return (state.fieldFeedback?.items||[]).filter(x=>{
    const t=Date.parse(x.observed_at||"");
    return Number.isFinite(t)&&t>=cutoff;
  });
}
function recentFieldSignal(pointId,category){
  return freshFieldReports().find(x=>x.point_id===pointId&&feedbackCategory(x.note)===category)||null;
}

function parseTime(s){
  if(!s)return NaN;
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s)?s:s+"Z");
}
function localStamp(s,withDate=true){
  const d=new Date(s||"");
  if(!Number.isFinite(d.getTime()))return "-";
  return d.toLocaleString("vi-VN",{
    timeZone:"Asia/Ho_Chi_Minh",
    day:withDate?"2-digit":undefined,
    month:withDate?"2-digit":undefined,
    hour:"2-digit",minute:"2-digit",hour12:false
  });
}
function dayLabel(s){
  const d=new Date(s||"");
  if(!Number.isFinite(d.getTime()))return "-";
  return d.toLocaleDateString("vi-VN",{timeZone:"Asia/Ho_Chi_Minh",weekday:"short",day:"2-digit",month:"2-digit"});
}
function ageText(s){
  const t=Date.parse(s||"");
  if(!Number.isFinite(t))return "không rõ";
  const m=Math.max(0,(Date.now()-t)/60000);
  if(m<2)return "vừa cập nhật";
  if(m<60)return Math.round(m)+" phút";
  return (m/60).toFixed(1)+" giờ";
}
function distance2(a,b,c,d){return (a-c)*(a-c)+(b-d)*(b-d)}

function syncCrosshairSelection(){
  if(!state.crosshair||!state.map)return;
  const c=state.map.getCenter();
  state.selected={lat:c.lat,lon:c.lng,anchor:nearestAnchor(c.lat,c.lng)};
  if(state.flagMarker){state.map.removeLayer(state.flagMarker);state.flagMarker=null}
  updateReadout();
  updateConfidence();
}
function setCrosshair(enabled){
  state.crosshair=!!enabled;
  $("mapCrosshair")?.classList.toggle("hidden",!state.crosshair);
  $("crosshairBtn")?.classList.toggle("active",state.crosshair);
  if(state.crosshair)syncCrosshairSelection();
}

function initMap(){
  const pqBounds=L.latLngBounds([[9.64,103.64],[10.60,104.32]]);
  state.map=L.map("map",{
    zoomControl:false,
    attributionControl:true,
    minZoom:9,
    maxZoom:13,
    zoomSnap:.25,
    zoomDelta:.5,
    bounceAtZoomLimits:false,
    maxBounds:pqBounds,
    maxBoundsViscosity:.28,
    preferCanvas:true
  });
  state.map.setView([10.19,103.98],EMBED?9.65:10.0);

  // Windy-style render stack:
  // basemap geometry -> weather canvases -> labels -> JoTrip markers/flag.
  state.map.createPane("weatherContext");
  const contextPane=state.map.getPane("weatherContext");
  contextPane.style.zIndex="430";
  contextPane.style.pointerEvents="none";

  state.map.createPane("weatherLabels");
  const labelPane=state.map.getPane("weatherLabels");
  labelPane.style.zIndex="580";
  labelPane.style.pointerEvents="none";

  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png?key=cb1_3q98_1_d8112ce70cc7ec9b9276b0a0",{
    subdomains:"abcd",
    maxZoom:19,
    attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>'
  }).addTo(state.map);

  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png?key=cb1_3q98_1_d8112ce70cc7ec9b9276b0a0",{
    subdomains:"abcd",
    maxZoom:19,
    pane:"weatherContext",
    opacity:.22
  }).addTo(state.map);

  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png?key=cb1_3q98_1_d8112ce70cc7ec9b9276b0a0",{
    subdomains:"abcd",
    maxZoom:19,
    pane:"weatherLabels"
  }).addTo(state.map);

  const mapEl=state.map.getContainer();
  [
    ["fieldCanvas",300],
    ["uncertaintyCanvas",360],
    ["flowCanvas",500],
  ].forEach(([id,z])=>{
    const el=$(id);
    mapEl.appendChild(el);
    el.style.zIndex=String(z);
  });

  state.riskLayer=L.layerGroup().addTo(state.map);
  state.actualLayer=L.layerGroup().addTo(state.map);
  state.map.on("moveend zoomend",()=>{
    renderField();resetParticles();renderUncertainty();
    if(state.crosshair)syncCrosshairSelection();
    else if(state.flagMarker)updateSelectionFlag();
  });
  state.map.on("click",onMapClick);
}

function ecmwfFrames(){return state.ecmwf?.spatial?.frames||[]}
function gefsFrames(){return state.gefs?.spatial?.frames||[]}
function cloudFrames(){return state.nowcast?.spatial?.frames||[]}
function marineCurrentRows(){return state.marine?.current?.cells||[]}
function marineWaveRows(){return state.marine?.wave?.cells||[]}
function iconRows(){return state.icon?.spatial?.cells||[]}
function baseFrames(){return ecmwfFrames().length?ecmwfFrames():gefsFrames()}

function nearestFrame(frames,targetTime){
  if(!frames?.length)return null;
  let best=frames[0],dist=Infinity;
  frames.forEach(f=>{
    const t=parseTime(f.valid_time||f.sampled_time),d=Math.abs(t-targetTime);
    if(Number.isFinite(t)&&d<dist){dist=d;best=f}
  });
  return best;
}
function nearestRow(rows,lat,lon){
  if(!rows?.length)return null;
  let best=null,dist=Infinity;
  rows.forEach(r=>{
    const d=distance2(r.lat,r.lon,lat,lon);
    if(d<dist){dist=d;best=r}
  });
  return best;
}
function nearestAnchor(lat,lon){
  let best="duong_dong",dist=Infinity;
  Object.entries(POINTS).forEach(([id,p])=>{
    const d=distance2(p.lat,p.lon,lat,lon);
    if(d<dist){dist=d;best=id}
  });
  return best;
}

const PALETTES={
  // Perceptual weather palette: subdued low-end, bright mid-range, warm high-end.
  // Inspired by modern global weather maps, but tuned for JoTrip's Phu Quoc data.
  wind:[[0,[66,72,152]],[.13,[55,99,182]],[.28,[49,151,200]],[.45,[57,190,167]],[.62,[112,199,109]],[.78,[216,205,88]],[.90,[235,148,69]],[1,[201,70,92]]],
  rain:[[0,[48,60,139]],[.12,[48,94,185]],[.27,[42,151,207]],[.44,[44,191,183]],[.61,[87,199,118]],[.76,[215,211,79]],[.89,[236,142,65]],[1,[201,60,96]]],
  rain24:[[0,[226,240,252]],[.10,[180,219,244]],[.24,[102,177,217]],[.42,[68,196,121]],[.58,[185,211,74]],[.74,[235,204,67]],[.88,[239,132,61]],[1,[173,57,122]]],
  waves:[[0,[59,69,150]],[.17,[52,109,188]],[.35,[46,157,202]],[.53,[55,190,174]],[.70,[111,198,116]],[.86,[217,198,83]],[1,[208,83,100]]],
  current:[[0,[52,78,154]],[.17,[43,123,190]],[.35,[37,171,198]],[.54,[48,197,166]],[.72,[104,198,111]],[.88,[220,191,76]],[1,[213,91,77]]],
  storm:[[0,[48,57,91]],[.25,[78,91,125]],[.48,[123,133,158]],[.68,[170,177,192]],[.84,[213,218,226]],[1,[248,250,252]]]
};
function colorAt(name,t){
  const p=PALETTES[name]||PALETTES.wind;t=clamp(t,0,1);
  for(let i=1;i<p.length;i++){
    if(t<=p[i][0]){
      const a=p[i-1],b=p[i],q=(t-a[0])/Math.max(.0001,b[0]-a[0]);
      const smooth=q*q*(3-2*q);
      return a[1].map((v,k)=>Math.round(v+(b[1][k]-v)*smooth));
    }
  }
  return p[p.length-1][1];
}
function piecewise(value,stops){
  const v=num(value);
  if(v===null)return 0;
  if(v<=stops[0][0])return stops[0][1];
  for(let i=1;i<stops.length;i++){
    if(v<=stops[i][0]){
      const a=stops[i-1],b=stops[i],q=(v-a[0])/Math.max(.0001,b[0]-a[0]);
      const smooth=q*q*(3-2*q);
      return a[1]+(b[1]-a[1])*smooth;
    }
  }
  return stops[stops.length-1][1];
}
function fieldTransfer(row,layer){
  if(layer==="wind")return piecewise(row.wind_kmh,[[0,.03],[4,.10],[8,.22],[14,.37],[22,.53],[30,.68],[40,.82],[55,1]]);
  if(layer==="rain")return piecewise(row.rain_mm,[[0,0],[.2,.08],[1,.20],[3,.36],[7,.53],[12,.68],[22,.84],[40,1]]);
  if(layer==="rain24")return piecewise(row.rain24_mm,[[0,0],[1,.08],[5,.20],[10,.34],[20,.50],[35,.66],[55,.82],[80,1]]);
  if(layer==="waves")return piecewise(validWaveHs(row.wave_hs_m),[[0,.03],[.25,.12],[.5,.27],[.8,.43],[1.2,.59],[1.8,.75],[2.8,.9],[4,1]]);
  if(layer==="current")return piecewise(row.speed_kmh,[[0,.03],[.15,.12],[.35,.27],[.65,.43],[1,.58],[1.5,.73],[2.2,.88],[3,1]]);
  return piecewise(row.convective_score,[[0,0],[20,.14],[40,.32],[60,.52],[75,.70],[90,.87],[100,1]]);
}
function fieldAlpha(layer,t,base){
  if(layer==="rain"||layer==="rain24")return base*clamp((t-.02)*1.35,.04,.96);
  if(layer==="wind")return base*clamp(.42+t*.72,.42,.96);
  if(layer==="waves"||layer==="current")return base*clamp(.36+t*.76,.36,.94);
  return base*clamp(.16+t*.84,.16,.96);
}
function canvasSize(c,scale=.30){
  const r=c.getBoundingClientRect();
  c.width=Math.max(120,Math.round(r.width*scale));
  c.height=Math.max(180,Math.round(r.height*scale));
  c.style.width=r.width+"px";c.style.height=r.height+"px";
  return {sx:c.width/r.width,sy:c.height/r.height};
}
function clearCanvas(id){
  const c=$(id),ctx=c.getContext("2d");
  ctx.clearRect(0,0,c.width,c.height);
}
function fieldNorm(row,layer){return clamp(fieldTransfer(row,layer),0,1)}
function median(values){
  if(!values.length)return 0;
  const a=[...values].sort((x,y)=>x-y),m=Math.floor(a.length/2);
  return a.length%2?a[m]:(a[m-1]+a[m])/2;
}
function spatialSupportRadius(pts){
  if(pts.length<3)return Infinity;
  const nearest=[];
  for(let i=0;i<pts.length;i++){
    let best=Infinity;
    for(let k=0;k<pts.length;k++){
      if(i===k)continue;
      const dx=pts[i].x-pts[k].x,dy=pts[i].y-pts[k].y;
      best=Math.min(best,Math.sqrt(dx*dx+dy*dy));
    }
    if(Number.isFinite(best))nearest.push(best);
  }
  return median(nearest)*.92;
}
function bandedScalar(layer,v){
  const bands={
    rain:[0,.08,.20,.36,.53,.68,.84,1],
    rain24:[0,.08,.20,.34,.50,.66,.82,1],
    wind:[.03,.10,.22,.37,.53,.68,.82,1],
    waves:[.03,.12,.27,.43,.59,.75,.90,1],
    current:[.03,.12,.27,.43,.58,.73,.88,1]
  }[layer];
  if(!bands)return v;
  let b=0;
  for(let i=1;i<bands.length;i++){if(v>=bands[i])b=i}
  return bands[b];
}
function deterministic01(a,b,salt=0){
  const x=Math.sin((a*12.9898+b*78.233+salt*37.719))*43758.5453;
  return x-Math.floor(x);
}
function drawVectorTexture(rows,kind){
  const c=$("fieldCanvas"),ctx=c.getContext("2d"),rect=c.getBoundingClientRect();
  if(!c.width||!c.height||!rect.width||!rect.height)return;
  const dprX=c.width/rect.width,dprY=c.height/rect.height;
  const vectors=vectorRows(rows,kind);
  if(!vectors.length)return;
  const pv=vectors.map(r=>{
    const p=state.map.latLngToContainerPoint([r.lat,r.lon]);
    return {x:p.x*dprX,y:p.y*dprY,u:r.u,v:r.v,mag:r.mag};
  }).filter(v=>Number.isFinite(v.x)&&Number.isFinite(v.y));
  if(!pv.length)return;

  const marine=kind==="waves"||kind==="current";
  const support=marine?spatialSupportRadius(pv):Infinity;
  const support2=support*support+20;
  const step=kind==="waves"?13:kind==="current"?12:11;
  const len=kind==="waves"?7:kind==="current"?8:10;

  ctx.save();
  ctx.lineCap="round";
  ctx.globalCompositeOperation="soft-light";
  ctx.lineWidth=kind==="waves"?0.85:0.75;

  let salt=kind==="waves"?7:kind==="current"?13:3;
  for(let y=step/2;y<c.height;y+=step){
    for(let x=step/2;x<c.width;x+=step){
      const jx=(deterministic01(x,y,salt)-.5)*step*.8;
      const jy=(deterministic01(y,x,salt+1)-.5)*step*.8;
      const p={x:x+jx,y:y+jy};
      const n=interpolatedVectorAt(p,pv);
      if(!n)continue;
      if(marine&&n.near2>support2)continue;
      const m=Math.max(.0001,Math.hypot(n.u,n.v));
      const ux=n.u/m,uy=-n.v/m;
      const strength=kind==="wind"
        ?clamp((n.mag||0)/12,.16,.72)
        :kind==="waves"
          ?clamp((n.mag||0)/2,.15,.62)
          :clamp((n.mag||0)*2.2,.12,.55);
      const l=len*(.65+strength*.7);
      ctx.strokeStyle="rgba(255,255,255,"+(0.07+strength*.12).toFixed(3)+")";
      ctx.beginPath();
      ctx.moveTo(p.x-ux*l*.45,p.y-uy*l*.45);
      ctx.lineTo(p.x+ux*l*.55,p.y+uy*l*.55);
      ctx.stroke();

      ctx.strokeStyle="rgba(8,27,37,"+(0.035+strength*.055).toFixed(3)+")";
      ctx.beginPath();
      ctx.moveTo(p.x-ux*l*.30-uy*.6,p.y-uy*l*.30+ux*.6);
      ctx.lineTo(p.x+ux*l*.45-uy*.6,p.y+uy*l*.45+ux*.6);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawIDW(rows,layer,alpha=.76){
  const c=$("fieldCanvas"),ctx=c.getContext("2d"),s=canvasSize(c,innerWidth<760?.50:.46);
  ctx.clearRect(0,0,c.width,c.height);
  const pts=(rows||[]).map(r=>{
    const p=state.map.latLngToContainerPoint([r.lat,r.lon]);
    return {x:p.x*s.sx,y:p.y*s.sy,n:fieldNorm(r,layer)};
  }).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));
  if(!pts.length)return;

  const marine=layer==="waves"||layer==="current";
  const support=marine?spatialSupportRadius(pts):Infinity;
  const support2=support*support;
  const total=c.width*c.height;
  const field=new Float32Array(total);
  field.fill(-1);

  // Continuous physical interpolation first. Styling happens afterwards.
  for(let y=0;y<c.height;y++){
    for(let x=0;x<c.width;x++){
      let sw=0,sv=0,near2=Infinity;
      for(const p of pts){
        const dx=x-p.x,dy=y-p.y,d2=dx*dx+dy*dy+5,w=1/d2;
        near2=Math.min(near2,d2);
        sw+=w;sv+=w*p.n;
      }
      if(marine&&near2>support2)continue;
      field[y*c.width+x]=sw?sv/sw:0;
    }
  }

  const img=ctx.createImageData(c.width,c.height);
  const idx=(x,y)=>Math.max(0,Math.min(c.height-1,y))*c.width+Math.max(0,Math.min(c.width-1,x));
  const sample=(x,y,fallback)=>{
    const q=field[idx(x,y)];
    return q>=0?q:fallback;
  };

  for(let y=0;y<c.height;y++){
    for(let x=0;x<c.width;x++){
      const pos=y*c.width+x,raw=field[pos];
      if(raw<0)continue;

      const l=sample(x-2,y,raw),r=sample(x+2,y,raw);
      const u=sample(x,y-2,raw),d=sample(x,y+2,raw);
      const gx=(r-l)*.5,gy=(d-u)*.5,grad=Math.hypot(gx,gy);

      let visual=raw;
      let shade=1;

      if(["rain","rain24","wind","waves","current"].includes(layer)){
        // Windy-style readable zones: color is banded, relief still follows the
        // continuous physical field so the map keeps depth instead of flat blobs.
        visual=bandedScalar(layer,raw);
        const nx=-gx*8.2,ny=-gy*8.2,nz=1;
        const inv=1/Math.max(.001,Math.hypot(nx,ny,nz));
        const hill=nx*inv*(-.58)+ny*inv*(-.42)+nz*inv*.69;
        const edge=clamp(grad*(layer.startsWith("rain")?4.6:3.4),0,.16);
        shade=clamp(.84+hill*.22+Math.pow(raw,1.55)*.12+edge,.70,1.22);
      }else{
        const nx=-gx*7.5,ny=-gy*7.5,nz=1;
        const inv=1/Math.max(.001,Math.hypot(nx,ny,nz));
        const hill=nx*inv*(-.58)+ny*inv*(-.42)+nz*inv*.69;
        shade=clamp(.84+hill*.24+Math.pow(raw,1.7)*.08,.72,1.18);
      }

      const rgb=colorAt(layer,visual),k=pos*4;
      img.data[k]=Math.round(clamp(rgb[0]*shade,0,255));
      img.data[k+1]=Math.round(clamp(rgb[1]*shade,0,255));
      img.data[k+2]=Math.round(clamp(rgb[2]*shade,0,255));
      img.data[k+3]=Math.round(255*fieldAlpha(layer,raw,alpha));
    }
  }
  ctx.putImageData(img,0,0);

  // Static texture is derived from the actual vector field, not random weather detail.
  if(layer==="wind")drawVectorTexture(rows,"wind");
  if(layer==="waves")drawVectorTexture(rows,"waves");
  if(layer==="current")drawVectorTexture(rows,"current");
}

function cloudOpacity(row){
  const score=clamp((num(row?.convective_score)??0)/100,0,1);
  const cold=num(row?.cloud_top_cold_c);
  const medianTemp=num(row?.cloud_top_median_c);
  const high=num(row?.cloud_top_high_m);
  const medianHeight=num(row?.cloud_top_median_m);

  // Cloud rendering is not the convective proxy. Himawari cloud-top presence,
  // height and temperature establish the cloud mass; convection only adds a
  // small emphasis for deep/cold tops.
  const hasCloud=[cold,medianTemp,high,medianHeight].some(v=>v!==null&&Number.isFinite(v));
  if(!hasCloud)return 0;
  const coldness=cold===null?0:clamp((-cold-5)/65,0,1);
  const medianCold=medianTemp===null?0:clamp((-medianTemp)/55,0,1);
  const height=high===null?0:clamp((high-500)/13000,0,1);
  const medianH=medianHeight===null?0:clamp((medianHeight-300)/12000,0,1);
  return clamp(.10+height*.34+medianH*.24+coldness*.18+medianCold*.10+score*.08,0,1);
}
function coldCoreColor(coldC){
  const t=piecewise(-coldC,[[0,0],[25,.08],[40,.22],[50,.42],[60,.64],[70,.82],[80,1]]);
  const palette=[[0,[210,218,226]],[.2,[166,196,238]],[.4,[92,174,224]],[.58,[70,201,151]],[.74,[223,212,74]],[.88,[238,137,68]],[1,[205,67,92]]];
  for(let i=1;i<palette.length;i++){
    if(t<=palette[i][0]){
      const a=palette[i-1],b=palette[i],q=(t-a[0])/Math.max(.001,b[0]-a[0]);
      return a[1].map((v,k)=>Math.round(v+(b[1][k]-v)*q));
    }
  }
  return palette.at(-1)[1];
}
function drawCloudMass(rows,{clear=true,alphaScale=1}={}){
  const c=$("fieldCanvas"),ctx=c.getContext("2d"),rect=c.getBoundingClientRect();
  const s=clear||!c.width||!c.height
    ?canvasSize(c,innerWidth<760?.40:.36)
    :{sx:c.width/Math.max(1,rect.width),sy:c.height/Math.max(1,rect.height)};
  if(clear)ctx.clearRect(0,0,c.width,c.height);
  const pts=(rows||[]).map(r=>{
    const p=state.map.latLngToContainerPoint([r.lat,r.lon]);
    const cold=num(r.cloud_top_cold_c);
    return {x:p.x*s.sx,y:p.y*s.sy,n:cloudOpacity(r),cold:cold===null?0:clamp((-cold-15)/70,0,1)};
  }).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));
  if(!pts.length)return;

  const total=c.width*c.height;
  const densityField=new Float32Array(total);
  const coldField=new Float32Array(total);
  densityField.fill(-1);coldField.fill(0);

  for(let y=0;y<c.height;y++){
    for(let x=0;x<c.width;x++){
      let sw=0,sv=0,sc=0;
      for(const p of pts){
        const dx=x-p.x,dy=y-p.y,d2=dx*dx+dy*dy+10,w=1/d2;
        sw+=w;sv+=w*p.n;sc+=w*p.cold;
      }
      if(!sw)continue;
      densityField[y*c.width+x]=sv/sw;
      coldField[y*c.width+x]=sc/sw;
    }
  }

  const img=ctx.createImageData(c.width,c.height);
  const idx=(x,y)=>Math.max(0,Math.min(c.height-1,y))*c.width+Math.max(0,Math.min(c.width-1,x));
  const sample=(arr,x,y,fallback)=>{
    const v=arr[idx(x,y)];
    return Number.isFinite(v)&&v>=0?v:fallback;
  };

  for(let y=0;y<c.height;y++){
    for(let x=0;x<c.width;x++){
      const pos=y*c.width+x,v=densityField[pos];
      if(v<.07)continue;
      const density=clamp((v-.04)/.96,0,1);
      const coldN=coldField[pos];

      // Data-derived cloud relief: denser cloud tops catch light,
      // their down-gradient side becomes subtly shaded.
      const l=sample(densityField,x-2,y,v),r=sample(densityField,x+2,y,v);
      const u=sample(densityField,x,y-2,v),d=sample(densityField,x,y+2,v);
      const gx=(r-l)*.5,gy=(d-u)*.5;
      const lap=(l+r+u+d)-4*v;
      const nx=-gx*9,ny=-gy*9,nz=1;
      const inv=1/Math.max(.001,Math.hypot(nx,ny,nz));
      const hill=nx*inv*(-.58)+ny*inv*(-.42)+nz*inv*.69;
      const edgeLift=clamp(Math.abs(lap)*2.8,0,.10);
      const relief=clamp(.78+hill*.36+Math.pow(density,1.6)*.12+edgeLift,.62,1.27);

      const coldC=-(15+coldN*70);
      const core=coldCoreColor(coldC);
      const base=[214,222,230];
      const coreMix=clamp((coldN-.28)*1.35,0,.92);
      const k=pos*4;
      const rr=base[0]*(1-coreMix)+core[0]*coreMix;
      const gg=base[1]*(1-coreMix)+core[1]*coreMix;
      const bb=base[2]*(1-coreMix)+core[2]*coreMix;
      img.data[k]=Math.round(clamp(rr*relief,0,255));
      img.data[k+1]=Math.round(clamp(gg*relief,0,255));
      img.data[k+2]=Math.round(clamp(bb*relief,0,255));
      img.data[k+3]=Math.round(226*alphaScale*Math.pow(density,.76));
    }
  }
  ctx.putImageData(img,0,0);
}

function latestCloudRows(){
  const fs=cloudFrames();
  return fs.length?(fs[fs.length-1].cells||[]):[];
}
function rainGetsObservedCloudContext(){
  if(state.layer!=="rain")return false;
  const lead=currentLeadHours();
  return lead<=3&&latestCloudRows().length>0;
}

function genericRowsFromGEFS(frame,layer){
  return (frame?.cells||[]).map(c=>{
    if(layer==="wind")return {
      lat:cellLat(c.cell_id),lon:cellLon(c.cell_id),
      wind_kmh:num(c.wind?.q50),
      u10_ms:num(c.wind?.u10_q50_ms),
      v10_ms:num(c.wind?.v10_q50_ms),
      wind_direction_deg:num(c.wind?.direction_q50_deg),
      _ensemble:c.wind
    };
    if(layer==="rain")return {
      lat:cellLat(c.cell_id),lon:cellLon(c.cell_id),
      rain_mm:num(c.rain?.q50),
      _ensemble:c.rain
    };
    return null;
  }).filter(Boolean);
}
function cellLat(id){
  const m=String(id||"").match(/^grid_(-?\d+(?:\.\d+)?)_(-?\d+(?:\.\d+)?)$/);
  return m?Number(m[1]):0;
}
function cellLon(id){
  const m=String(id||"").match(/^grid_(-?\d+(?:\.\d+)?)_(-?\d+(?:\.\d+)?)$/);
  return m?Number(m[2]):0;
}

function activeECMWFFrame(){
  const frames=ecmwfFrames();
  if(!frames.length)return null;
  return frames[clamp(state.frameIndex,0,frames.length-1)];
}
function activeBaseFrame(){
  const frames=baseFrames();
  if(!frames.length)return null;
  return frames[clamp(state.frameIndex,0,frames.length-1)];
}
function activeValidTime(){
  if(state.layer==="storm"){
    const f=cloudFrames()[clamp(state.frameIndex,0,Math.max(0,cloudFrames().length-1))];
    return parseTime(f?.sampled_time);
  }
  if(state.layer==="radar"){
    const f=state.radarMeta?.frames?.[state.radarIndex];
    return f?f.time*1000:Date.now();
  }
  if(state.layer==="current")return parseTime(state.marine?.current?.sampled_time);
  return parseTime(activeBaseFrame()?.valid_time);
}
function isNearNowMarine(){
  const f=activeBaseFrame();
  const lead=num(f?.lead_hours);
  return lead===null||lead<=3;
}
function accumulation24Rows(){
  const frames=ecmwfFrames().filter(f=>{
    const lead=num(f.lead_hours);
    return lead!==null&&lead>0&&lead<=24;
  });
  const sums=new Map();
  for(const frame of frames){
    for(const cell of frame.cells||[]){
      const rain=validRange(cell.rain_mm,0,500);
      if(rain===null)continue;
      const key=(Number(cell.lat).toFixed(4))+"|"+(Number(cell.lon).toFixed(4));
      const prev=sums.get(key)||{lat:Number(cell.lat),lon:Number(cell.lon),rain24_mm:0,steps:0};
      prev.rain24_mm+=rain;prev.steps++;
      sums.set(key,prev);
    }
  }
  return [...sums.values()].map(r=>({...r,rain24_mm:Math.max(0,r.rain24_mm)}));
}

function activeRows(){
  if(state.layer==="storm"){
    const fs=cloudFrames();
    const i=clamp(state.frameIndex,0,Math.max(0,fs.length-1));
    const a=fs[i]?.cells||[];
    if(!a.length||!state.cloudTween||fs.length<2)return a;
    const b=fs[(i+1)%fs.length]?.cells||[];
    if(a.length!==b.length)return a;
    const t=clamp(state.cloudTween/5,0,1);
    return a.map((row,k)=>{
      const next=b[k]||row;
      const mix=(x,y)=>{
        const ax=num(x),by=num(y);
        if(ax===null)return by;
        if(by===null)return ax;
        return ax+(by-ax)*t;
      };
      return {
        ...row,
        cloud_top_cold_c:mix(row.cloud_top_cold_c,next.cloud_top_cold_c),
        cloud_top_median_c:mix(row.cloud_top_median_c,next.cloud_top_median_c),
        cloud_top_high_m:mix(row.cloud_top_high_m,next.cloud_top_high_m),
        cloud_top_median_m:mix(row.cloud_top_median_m,next.cloud_top_median_m),
        cooling_c_per_20m_proxy:mix(row.cooling_c_per_20m_proxy,next.cooling_c_per_20m_proxy),
        convective_score:mix(row.convective_score,next.convective_score),
      };
    });
  }
  if(state.layer==="rain24")return accumulation24Rows();
  if(state.layer==="current")return marineCurrentRows().filter(r=>num(r.speed_kmh)!==null);
  if(state.layer==="waves"&&isNearNowMarine()&&marineWaveRows().length){
    return marineWaveRows().filter(r=>validWaveHs(r.wave_hs_m)!==null&&validWaveDir(r.wave_direction_deg)!==null);
  }
  const frame=activeECMWFFrame();
  if(frame?.cells?.length){
    if(state.layer==="waves")return frame.cells.filter(r=>validWaveHs(r.wave_hs_m)!==null&&validWaveDir(r.wave_direction_deg)!==null);
    if(state.layer==="rain")return frame.cells.filter(r=>num(r.rain_mm)!==null);
    if(state.layer==="wind")return frame.cells.filter(r=>num(r.wind_kmh)!==null);
    return frame.cells;
  }
  const gf=gefsFrames()[clamp(state.frameIndex,0,Math.max(0,gefsFrames().length-1))];
  return genericRowsFromGEFS(gf,state.layer);
}

function applyPresentationScene(){
  const mapEl=state.map?.getContainer();
  if(!mapEl)return;
  mapEl.dataset.weatherLayer=state.layer;
}
function renderField(){
  if(state.layer==="radar"){clearCanvas("fieldCanvas");clearCanvas("uncertaintyCanvas");return}
  const fieldCanvas=$("fieldCanvas");
  fieldCanvas.style.filter=state.layer==="storm"?"blur(2.2px) saturate(1.16) contrast(1.10)"
    :state.layer==="rain"?"blur(.6px) saturate(1.28) contrast(1.13)"
    :state.layer==="rain24"?"blur(.5px) saturate(1.22) contrast(1.10)"
    :state.layer==="wind"?"saturate(1.22) contrast(1.12)"
    :state.layer==="waves"?"saturate(1.20) contrast(1.10)"
    :state.layer==="current"?"saturate(1.18) contrast(1.10)"
    :"none";
  fieldCanvas.style.opacity=state.layer==="storm"?"0.94":"1";
  const rows=activeRows();
  state.currentRows=rows;
  state.currentFrame=state.layer==="storm"
    ?cloudFrames()[clamp(state.frameIndex,0,Math.max(0,cloudFrames().length-1))]
    :state.layer==="current"
      ?state.marine?.current||null
      :activeECMWFFrame();

  if(state.layer==="storm"){
    drawCloudMass(rows);
    return;
  }

  const alpha=state.layer==="wind"?.86
    :state.layer==="rain"?.92
    :state.layer==="rain24"?.94
    :state.layer==="waves"?.84
    :state.layer==="current"?.82
    :.82;
  drawIDW(rows,state.layer,alpha);

  // Near-NOW Rain gets a subtle observed Himawari cloud context, similar to
  // weather-map products that layer precipitation under current cloud cover.
  // Never project a current satellite scan into future forecast frames.
  if(rainGetsObservedCloudContext()){
    drawCloudMass(latestCloudRows(),{clear:false,alphaScale:.22});
  }
}

function drawUncertaintyField(rows,layer,kind="ensemble"){
  const c=$("uncertaintyCanvas"),ctx=c.getContext("2d"),s=canvasSize(c,.24);
  ctx.clearRect(0,0,c.width,c.height);
  if(!rows?.length)return;
  const pts=rows.map(r=>{
    const p=state.map.latLngToContainerPoint([r.lat,r.lon]);
    return {x:p.x*s.sx,y:p.y*s.sy,n:clamp(r.u,0,1)};
  }).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));
  if(!pts.length)return;
  const img=ctx.createImageData(c.width,c.height);
  for(let y=0;y<c.height;y++){
    for(let x=0;x<c.width;x++){
      let sw=0,sv=0;
      for(const p of pts){
        const dx=x-p.x,dy=y-p.y,d2=dx*dx+dy*dy+4,w=1/d2;
        sw+=w;sv+=w*p.n;
      }
      const v=sv/sw;
      if(v<.08)continue;
      const k=(y*c.width+x)*4;
      if(kind==="modelDiff"){
        img.data[k]=236;img.data[k+1]=91;img.data[k+2]=54;
        img.data[k+3]=Math.round(170*clamp((v-.05)/.95,0,1));
      }else{
        img.data[k]=117;img.data[k+1]=67;img.data[k+2]=170;
        img.data[k+3]=Math.round(145*clamp((v-.05)/.95,0,1));
      }
    }
  }
  ctx.putImageData(img,0,0);
}
function modelDiffAvailable(){
  return state.layer==="wind"&&isNearNowMarine()&&iconRows().length>0&&activeRows().length>0;
}
function updateModelDiffControl(){
  const btn=$("modelDiffBtn");
  const available=modelDiffAvailable();
  btn.classList.toggle("hidden",!available);
  if(!available&&state.modelDiff){
    state.modelDiff=false;
    btn.classList.remove("active");
  }
}
function renderModelDiff(){
  const ecmwf=activeRows();
  const rows=iconRows().map(icon=>{
    const base=nearestRow(ecmwf,icon.lat,icon.lon);
    const a=num(base?.wind_kmh),b=num(icon?.wind_kmh);
    const diff=a!==null&&b!==null?Math.abs(a-b):0;
    return {lat:icon.lat,lon:icon.lon,u:clamp(diff/15,0,1)};
  });
  drawUncertaintyField(rows,"wind","modelDiff");
}
function renderUncertainty(){
  clearCanvas("uncertaintyCanvas");
  updateModelDiffControl();
  if(state.modelDiff&&modelDiffAvailable()){
    renderModelDiff();
    return;
  }
  if(!state.ensemble||!state.gefs||!["wind","rain"].includes(state.layer))return;
  const t=activeValidTime();
  const frame=nearestFrame(gefsFrames(),Number.isFinite(t)?t:Date.now());
  if(!frame)return;
  const rows=(frame.cells||[]).map(c=>{
    const dist=state.layer==="wind"?c.wind:c.rain;
    const prob=num(dist?.prob)??0;
    const spread=num(dist?.spread)??0;
    const spreadNorm=state.layer==="wind"?clamp(spread/20,0,1):clamp(spread/10,0,1);
    return {lat:cellLat(c.cell_id),lon:cellLon(c.cell_id),u:Math.max(prob,spreadNorm*.55)};
  });
  drawUncertaintyField(rows,state.layer);
}

function fitFlow(){
  const c=$("flowCanvas"),r=c.getBoundingClientRect();
  const dpr=Math.min(innerWidth<700?1.8:1.6,devicePixelRatio||1);
  c.width=Math.round(r.width*dpr);c.height=Math.round(r.height*dpr);c.dataset.dpr=dpr;
}
function stopParticles(){
  if(state.particleRAF)cancelAnimationFrame(state.particleRAF);
  state.particleRAF=null;state.particleRows=null;state.particles=[];
  clearCanvas("flowCanvas");
}
function resetParticles(){
  if(!state.particleRows)return;
  fitFlow();
  const c=$("flowCanvas");
  const lowMotion=matchMedia("(prefers-reduced-motion: reduce)").matches;
  const count=lowMotion?(innerWidth<700?120:180):(innerWidth<700?360:620);
  state.particles=Array.from({length:count},()=>({
    x:Math.random()*c.width,y:Math.random()*c.height,
    vx:0,vy:0,age:Math.random()*125,max:100+Math.random()*175
  }));
}
function vectorRows(rows,kind){
  if(kind==="current"){
    return (rows||[]).filter(r=>num(r.u_ms)!==null&&num(r.v_ms)!==null).map(r=>({
      ...r,u:num(r.u_ms),v:num(r.v_ms),mag:(num(r.speed_kmh)??0)/3.6
    }));
  }
  if(kind==="waves"){
    return (rows||[]).filter(r=>validWaveDir(r.wave_direction_deg)!==null&&validWaveHs(r.wave_hs_m)!==null).map(r=>{
      const to=(validWaveDir(r.wave_direction_deg)+180)*Math.PI/180;
      const mag=validWaveHs(r.wave_hs_m)||0;
      return {...r,u:Math.sin(to)*mag,v:Math.cos(to)*mag,mag};
    });
  }
  return (rows||[]).filter(r=>num(r.u10_ms)!==null&&num(r.v10_ms)!==null).map(r=>({
    ...r,u:num(r.u10_ms),v:num(r.v10_ms),mag:Math.hypot(num(r.u10_ms),num(r.v10_ms))
  }));
}
function interpolatedVectorAt(p,pv){
  if(!pv.length)return null;
  const nearest=[];
  for(const v of pv){
    const dx=p.x-v.x,dy=p.y-v.y,d2=dx*dx+dy*dy+18;
    let inserted=false;
    for(let i=0;i<nearest.length;i++){
      if(d2<nearest[i].d2){nearest.splice(i,0,{v,d2});inserted=true;break}
    }
    if(!inserted)nearest.push({v,d2});
    if(nearest.length>4)nearest.length=4;
  }
  let sw=0,u=0,vv=0,mag=0;
  for(const item of nearest){
    const w=1/item.d2;
    sw+=w;u+=item.v.u*w;vv+=item.v.v*w;mag+=(item.v.mag||0)*w;
  }
  return sw?{u:u/sw,v:vv/sw,mag:mag/sw,near2:nearest[0]?.d2??Infinity}:null;
}
function startParticles(rows,kind){
  stopParticles();
  const lowMotion=matchMedia("(prefers-reduced-motion: reduce)").matches;
  let vectors=vectorRows(rows,kind);
  if(!vectors.length&&kind!=="waves"&&state.gefs){
    const gf=nearestFrame(gefsFrames(),activeValidTime()||Date.now());
    vectors=vectorRows(genericRowsFromGEFS(gf,"wind"),"wind");
  }
  if(!vectors.length)return;
  state.particleRows=vectors;
  fitFlow();resetParticles();
  const c=$("flowCanvas"),ctx=c.getContext("2d");
  const tick=()=>{
    if(!state.particleRows)return;
    ctx.globalCompositeOperation="destination-out";
    ctx.fillStyle=lowMotion?"rgba(0,0,0,.075)":"rgba(0,0,0,.036)";
    ctx.fillRect(0,0,c.width,c.height);
    ctx.globalCompositeOperation="source-over";
    ctx.strokeStyle=kind==="waves"
      ?"rgba(224,245,255,.90)"
      :kind==="current"
        ?"rgba(190,245,239,.90)"
        :"rgba(245,252,255,.97)";
    ctx.lineWidth=innerWidth<700
      ?(kind==="waves"?1.45:kind==="current"?1.35:1.75)
      :(kind==="waves"?1.35:kind==="current"?1.25:1.55);
    ctx.shadowColor="rgba(0,0,0,.46)";
    ctx.shadowBlur=1.15;
    const dpr=Number(c.dataset.dpr)||1;
    const pv=state.particleRows.map(r=>{
      const p=state.map.latLngToContainerPoint([r.lat,r.lon]);
      return {x:p.x*dpr,y:p.y*dpr,u:r.u,v:r.v,mag:r.mag};
    });
    const marine=kind==="waves"||kind==="current";
    const support=marine?spatialSupportRadius(pv):Infinity;
    const support2=support*support+18;
    state.particles.forEach(p=>{
      const n=interpolatedVectorAt(p,pv);
      if(!n)return;
      if(marine&&n.near2>support2){
        p.x=Math.random()*c.width;p.y=Math.random()*c.height;p.vx=0;p.vy=0;p.age=0;
        return;
      }
      let scale=kind==="waves"
        ?clamp((n.mag||0)*1.15,.38,1.85)
        :kind==="current"
          ?clamp((n.mag||0)*2.2,.28,1.35)
          :clamp((n.mag||0)/3.15,1.0,5.2);
      if(lowMotion)scale*=.42;
      const m=Math.max(.001,Math.hypot(n.u,n.v));
      const targetX=(n.u/m)*scale,targetY=-(n.v/m)*scale;
      const turn=kind==="waves"?.10:kind==="current"?.18:.36;
      if(!p.vx&&!p.vy){p.vx=targetX;p.vy=targetY}
      else{
        p.vx+= (targetX-p.vx)*turn;
        p.vy+= (targetY-p.vy)*turn;
      }
      const trail=innerWidth<700?3.15:2.8;
      const nx=p.x+p.vx*trail,ny=p.y+p.vy*trail;
      ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(nx,ny);ctx.stroke();
      p.x=nx;p.y=ny;p.age++;
      if(p.age>p.max||p.x<0||p.y<0||p.x>c.width||p.y>c.height){
        p.x=Math.random()*c.width;p.y=Math.random()*c.height;p.vx=0;p.vy=0;p.age=0;p.max=85+Math.random()*150;
      }
    });
    state.particleRAF=requestAnimationFrame(tick);
  };
  tick();
}

function clearRadar(){
  if(state.radarLayers.length){
    state.radarLayers.forEach(l=>{try{state.map.removeLayer(l)}catch{}});
    state.radarLayers=[];
  }
  state.radarMeta=null;state.radarIndex=0;
}
async function loadRadar(){
  if(state.radarMeta)return;
  const raw=await fetchJSON("https://api.rainviewer.com/public/weather-maps.json");
  const frames=(raw?.radar?.past||[]).slice(-8);
  if(!frames.length)throw new Error("Radar unavailable");
  state.radarMeta={host:raw.host,frames};
  state.radarLayers=frames.map((f,i)=>L.tileLayer(raw.host+f.path+"/256/{z}/{x}/{y}/2/1_0.png",{
    opacity:i===frames.length-1?.78:0,maxNativeZoom:7,maxZoom:13,zIndex:550,
    attribution:'Radar by <a href="https://www.rainviewer.com/" target="_blank" rel="noopener">RainViewer</a>'
  }).addTo(state.map));
  state.radarIndex=frames.length-1;
}
function showRadar(i){
  const fs=state.radarMeta?.frames||[];if(!fs.length)return;
  i=clamp(i,0,fs.length-1);state.radarIndex=i;
  state.radarLayers.forEach((l,k)=>l.setOpacity(k===i?.78:0));
  $("timeLabel").textContent=localStamp(new Date(fs[i].time*1000).toISOString(),false);
}
function playRadar(){
  stopTimer();
  $("playBtn").textContent="❚❚";
  state.timer=setInterval(()=>showRadar((state.radarIndex+1)%(state.radarMeta?.frames?.length||1)),800);
}

function renderRisk(){
  state.riskLayer.clearLayers();
  if(!state.risk||!state.critical)return;
  const ids=(state.critical.island_watch_order||Object.keys(POINTS))
    .filter(id=>POINTS[id]&&state.critical.points?.[id]);
  const ranked=ids.map(id=>({id,r:riskAt(id)})).sort((a,b)=>b.r.level-a.r.level);
  const worst=ranked[0]?.id||null;
  const zoom=state.map?.getZoom?.()||10;
  ids.forEach(id=>{
    const cfg=POINTS[id],r=riskAt(id);
    const icon=L.divIcon({className:"",html:'<div class="risk-dot '+riskClass(r.level)+'"></div>',iconSize:[10,10],iconAnchor:[5,5]});
    const m=L.marker([cfg.lat,cfg.lon],{icon,zIndexOffset:900}).addTo(state.riskLayer);
    m.on("click",e=>{L.DomEvent.stopPropagation(e);selectAnchorFlag(id)});
    const selected=id===state.selected.anchor;
    const severe=id===worst&&r.level>=3;
    const zoomed=zoom>=12&&r.level>=2;
    const major=["duong_dong","ganh_dau","an_thoi"].includes(id)&&zoom<=11.3;
    if(selected||severe||zoomed||major){
      const li=L.divIcon({className:"",html:'<div class="risk-label">'+esc(cfg.name)+' · '+riskLabel(r.level)+'</div>',iconSize:[118,20],iconAnchor:[59,-9]});
      L.marker([cfg.lat,cfg.lon],{icon:li,interactive:false,zIndexOffset:850}).addTo(state.riskLayer);
    }
  });
}
function renderActual(){
  state.actualLayer.clearLayers();
  if(!state.actual||!state.critical)return;
  const a=state.critical.actual||{},v=a.vvpq||{};
  if(v.status){
    const ic=L.divIcon({className:"",html:'<div class="actual-pin metar"></div>',iconSize:[15,15],iconAnchor:[7,7]});
    const m=L.marker([10.169,103.995],{icon:ic,zIndexOffset:1000}).addTo(state.actualLayer);
    m.on("click",e=>{L.DomEvent.stopPropagation(e);showActualFlag("VVPQ",v,10.169,103.995)});
    const li=L.divIcon({className:"",html:'<div class="actual-label">VVPQ · '+fmt(v.wind_kmh,0)+' km/h</div>',iconSize:[100,20],iconAnchor:[50,-9]});
    L.marker([10.169,103.995],{icon:li,interactive:false,zIndexOffset:950}).addTo(state.actualLayer);
  }
  (a.rain_gauges||[]).forEach(g=>{
    if(num(g.lat)===null||num(g.lon)===null)return;
    const ic=L.divIcon({className:"",html:'<div class="actual-pin rain"></div>',iconSize:[15,15],iconAnchor:[7,7]});
    const m=L.marker([g.lat,g.lon],{icon:ic,zIndexOffset:1000}).addTo(state.actualLayer);
    m.on("click",e=>{L.DomEvent.stopPropagation(e);showActualFlag(g.name||"VRain",g,g.lat,g.lon)});
    const val=num(g.rain_intensity_mm_h)!==null?fmt(g.rain_intensity_mm_h,1)+" mm/h":fmt(g.accum_mm,1)+" mm";
    const li=L.divIcon({className:"",html:'<div class="actual-label">'+esc(g.name||"VRain")+' · '+val+'</div>',iconSize:[120,20],iconAnchor:[60,-9]});
    L.marker([g.lat,g.lon],{icon:li,interactive:false,zIndexOffset:950}).addTo(state.actualLayer);
  });
}

function nearestEnsembleRow(p,lead){
  const rows=p?.ensemble?.rows||[];let best=null,d=Infinity;
  rows.forEach(r=>{const l=num(r.lead_hours);if(l===null)return;const dd=Math.abs(l-lead);if(dd<d){d=dd;best=r}});
  return best;
}
function currentRisk(p){
  const l=p.local||{},m=p.model||{},n=p.nowcast||{};
  const id=Object.keys(state.critical?.points||{}).find(k=>state.critical.points[k]===p)||null;
  const conv=num(n.convective_score??l.convection_score);
  const wind=num(l.wind_kmh??m.wind_kmh),gust=num(m.gust_kmh);
  const rain=num(l.rain_rate_mm_h),wave=num(l.wave_hs_m??m.wave_hs_m);
  let level=0,reasons=[];

  if(id&&recentFieldSignal(id,"RAIN_MORE")){
    level=Math.max(level,3);
    reasons.push("phản hồi tại chỗ cho biết mưa lớn hơn hệ thống đang ước tính");
  }
  if(id&&recentFieldSignal(id,"WIND_MORE")){
    level=Math.max(level,2);
    reasons.push("phản hồi tại chỗ cho biết gió mạnh hơn hệ thống đang ước tính");
  }
  if(rain!==null&&rain>=7.5){level=Math.max(level,3);reasons.push("mưa hiện tại đang mạnh")}
  else if(rain!==null&&rain>=2.5){level=Math.max(level,2);reasons.push("mưa hiện tại ở mức vừa")}
  else if(rain!==null&&rain>=.5){level=Math.max(level,1);reasons.push("đang có mưa nhẹ")}

  if(conv!==null&&conv>=75){level=Math.max(level,2);reasons.push("có vùng mây rất cao, dễ kèm mưa dông")}
  else if(conv!==null&&conv>=55){level=Math.max(level,1);reasons.push("mây đang phát triển")}

  if(wind!==null&&wind>=40){level=Math.max(level,3);reasons.push("gió hiện tại đang rất mạnh")}
  else if(wind!==null&&wind>=30){level=Math.max(level,2);reasons.push("gió hiện tại đang mạnh")}
  else if(gust!==null&&gust>=40){level=Math.max(level,2);reasons.push("gió giật có thể tăng")}

  if(wave!==null&&wave>=2){level=Math.max(level,3);reasons.push("sóng nền cao")}
  else if(wave!==null&&wave>=1.5){level=Math.max(level,2);reasons.push("sóng đang tăng")}

  return {level,reasons};
}

function futureRisk(row){
  if(!row)return {level:0,reasons:[]};
  const wp=num(row.wind?.prob)||0,rp=num(row.rain?.prob)||0,w95=num(row.wind?.q95),r90=num(row.rain?.q90);
  let level=0,reasons=[];
  if(wp>=.45||(w95!==null&&w95>=39)){level=3;reasons.push("gió mạnh")}else if(wp>=.20||(w95!==null&&w95>=30)){level=Math.max(level,2);reasons.push("gió cần theo dõi")}else if(wp>=.08)level=Math.max(level,1);
  if(rp>=.65||(r90!==null&&r90>=20)){level=3;reasons.push("mưa cao")}else if(rp>=.35||(r90!==null&&r90>=8)){level=Math.max(level,2);reasons.push("mưa tăng")}else if(rp>=.15)level=Math.max(level,1);
  return {level,reasons};
}
function regionalRiskAt(id,lead){
  if(!state.forecast)return {level:0,reasons:["D4-D10 trend only"]};
  const regionId=POINTS[id]?.region||"central_west";
  const rows=state.forecast.regions?.[regionId]?.rows||[];
  let best=null,d=Infinity;
  rows.forEach(r=>{const dd=Math.abs((num(r.lead_hours)||0)-lead);if(dd<d){d=dd;best=r}});
  if(!best)return {level:0,reasons:["D4-D10 trend only"]};
  const wp=num(best.wind_prob_30)||0,rp=num(best.rain_prob_5)||0;
  const w90=num(best.wind_q90_kmh),r90=num(best.rain_q90_mm),vari=num(best.variability_score)||0;
  let level=0,reasons=[];
  if(wp>=.45||(w90!==null&&w90>=39)){level=3;reasons.push("ensemble gió mạnh")}
  else if(wp>=.20||(w90!==null&&w90>=30)){level=Math.max(level,2);reasons.push("ensemble gió cần theo dõi")}
  else if(wp>=.08)level=Math.max(level,1);
  if(rp>=.65||(r90!==null&&r90>=20)){level=3;reasons.push("ensemble mưa cao")}
  else if(rp>=.35||(r90!==null&&r90>=8)){level=Math.max(level,2);reasons.push("ensemble mưa tăng")}
  else if(rp>=.15)level=Math.max(level,1);
  if(vari>=70){level=Math.max(level,2);reasons.push("độ phân tán cao")}
  return {level,reasons,confidence:num(best.confidence_score),variability:vari};
}
function riskAt(id){
  const p=state.critical?.points?.[id]||{};
  const lead=currentLeadHours();
  if(lead>72)return regionalRiskAt(id,lead);
  return lead>0?futureRisk(nearestEnsembleRow(p,lead)):currentRisk(p);
}
function riskClass(v){return v>=3?"alert":v>=1?"watch":"ok"}
function riskLabel(v){return v>=3?"CAO":v>=2?"THEO DÕI":v>=1?"LƯU Ý":"ỔN"}

function currentLeadHours(){
  if(state.layer==="storm"||state.layer==="radar"||state.layer==="current")return 0;
  const f=activeBaseFrame();
  if(f&&num(f.lead_hours)!==null)return num(f.lead_hours);
  const t=activeValidTime();return Number.isFinite(t)?Math.max(0,Math.round((t-Date.now())/3600000)):0;
}
function regionalForecastRow(){
  if(!state.forecast)return null;
  const anchor=state.selected.anchor||nearestAnchor(state.selected.lat,state.selected.lon);
  const regionId=POINTS[anchor]?.region||"central_west";
  const rows=state.forecast.regions?.[regionId]?.rows||[];
  const lead=currentLeadHours();
  let best=null,d=Infinity;
  rows.forEach(r=>{const dd=Math.abs((num(r.lead_hours)||0)-lead);if(dd<d){d=dd;best=r}});
  return best;
}
function updateConfidence(){
  if(state.layer==="rain24"){
    $("modelName").textContent="ECMWF 24H";
    $("modelRun").textContent=state.ecmwf?.run_time?localStamp(state.ecmwf.run_time):"-";
    return;
  }
  if(state.layer==="current"){
    $("confidenceLabel").textContent="Dữ liệu biển gần hiện tại";
    $("trendLabel").textContent="DÒNG MẶT";
    return;
  }
  if(state.layer==="storm"){
    $("confidenceLabel").textContent="Ảnh vệ tinh quan trắc";
    $("trendLabel").textContent="HIMAWARI";
    return;
  }
  if(state.layer==="radar"){
    $("confidenceLabel").textContent="Radar quan trắc";
    $("trendLabel").textContent="RADAR";
    return;
  }
  const row=regionalForecastRow();
  const lead=currentLeadHours();
  $("confidenceLabel").textContent=row?"Tin cậy "+fmt(row.confidence_score,0)+"/100":"Tin cậy --";
  $("trendLabel").textContent=lead>72?"Ngày "+Math.round(lead/24):"+"+Math.round(lead)+" giờ";
}

function renderScale(){
  const cfg={
    wind:{g:"linear-gradient(90deg,#3f53ab,#3580c5,#36b3ba,#41c370,#dcc541,#e87d3d,#ca4259)",l:["0","10","20","30","40+"]},
    rain:{g:"linear-gradient(90deg,#3652a4,#367cc5,#34afcf,#39c984,#dfd444,#ec823d,#cd425d)",l:["0","1","3","8","15+"]},
    rain24:{g:"linear-gradient(90deg,#eef6ff,#b9dbf5,#63add7,#48c477,#d6d93d,#f0a23e,#e35b52,#a93e84)",l:["0","5","10","20","35","55","80+"]},
    waves:{g:"linear-gradient(90deg,#374c99,#3474bd,#36a7c8,#45c59b,#d8bd44,#ca4767)",l:["0",".5","1","1.5","2+"]},
    current:{g:"linear-gradient(90deg,#3058a1,#2a89be,#28b8bc,#43c991,#e1c242,#dc5c48)",l:["0",".5","1","2","3+"]},
    storm:{g:"linear-gradient(90deg,#374991,#4268b8,#6d5cbe,#b04daa,#e56950,#be345b)",l:["0","25","50","75","100"]},
    radar:{g:"linear-gradient(90deg,#4559ad,#39a2c9,#4bc77d,#e5d64a,#e57b3d,#cb455c)",l:["Light","","","","Heavy"]}
  }[state.layer];
  $("scaleGradient").style.background=cfg.g;
  $("scaleLabels").innerHTML=cfg.l.map(x=>"<span>"+x+"</span>").join("");
}

function updateReadout(){
  const lead=currentLeadHours();
  const near=lead<=3;
  if(state.layer==="radar"){
    $("readoutSource").textContent="RADAR · QUAN TRẮC";
    $("readoutValue").textContent="RADAR";$("readoutUnit").textContent="";
    $("readoutPlace").textContent="Phú Quốc";
    $("readoutMeta").textContent=state.radarMeta?"Chuỗi ảnh gần thời điểm hiện tại":"Đang tải radar...";
    return;
  }
  const row=nearestRow(state.currentRows,state.selected.lat,state.selected.lon);
  const anchor=state.selected.anchor;
  $("readoutPlace").textContent=POINTS[anchor]?.name||"Điểm chọn";

  if(state.layer==="wind"){
    const local=near?localMetric(anchor,"wind"):null;
    const speed=local??num(row?.wind_kmh);
    const dir=(near?localMetric(anchor,"wind_direction"):null)??row?.wind_direction_deg;
    const gust=near?localMetric(anchor,"gust"):productionMetric(anchor,"gust");
    $("readoutSource").textContent=local!==null?"JOTRIP LOCAL NOW · GIÓ":"MÔ HÌNH GIÓ · ECMWF";
    $("readoutValue").textContent=fmt(speed,0);$("readoutUnit").textContent="km/h";
    $("readoutMeta").textContent=(dir!==null?"Gió từ "+directionText(dir):"Hướng gió chưa rõ")+(gust!==null?" · giật khoảng "+fmt(gust,0)+" km/h":"");
  }else if(state.layer==="rain"){
    const local=near?localMetric(anchor,"rain"):null;
    if(local!==null){
      $("readoutSource").textContent="JOTRIP LOCAL NOW · MƯA";
      $("readoutValue").textContent=fmt(local,1);$("readoutUnit").textContent="mm/h";
      const field=recentFieldSignal(anchor,"RAIN_MORE");
      $("readoutMeta").textContent=field?"Phản hồi thực địa mới: mưa đang nhiều hơn ước tính":"Ước tính mưa hiện tại tại khu vực";
    }else{
      $("readoutSource").textContent="MÔ HÌNH MƯA · ECMWF";
      $("readoutValue").textContent=fmt(row?.rain_mm,1);$("readoutUnit").textContent="mm";
      $("readoutMeta").textContent="Lượng mưa trong mốc dự báo đang chọn";
    }
  }else if(state.layer==="rain24"){
    $("readoutSource").textContent="ECMWF · MƯA 24 GIỜ TỚI";
    $("readoutValue").textContent=fmt(row?.rain24_mm,1);$("readoutUnit").textContent="mm";
    $("readoutMeta").textContent="Lượng mưa dự báo tích lũy 24 giờ · không phải số đo thực tế";
  }else if(state.layer==="waves"){
    const local=near?localMetric(anchor,"wave"):null;
    $("readoutSource").textContent=local!==null?"JOTRIP · SÓNG HIỆN TẠI":"MÔ HÌNH SÓNG · ECMWF";
    $("readoutValue").textContent=fmt(local??validWaveHs(row?.wave_hs_m),1);$("readoutUnit").textContent="m Hs";
    const waveDir=validWaveDir(row?.wave_direction_deg);
    $("readoutMeta").textContent="Sóng từ "+directionText(waveDir)+" · chu kỳ "+fmt(validWavePeriod(row?.wave_period_s??row?.wave_mean_period_s??row?.wave_peak_period_s),1)+" giây";
  }else if(state.layer==="current"){
    $("readoutSource").textContent="COPERNICUS · DÒNG CHẢY MẶT";
    $("readoutValue").textContent=fmt(row?.speed_kmh,2);$("readoutUnit").textContent="km/h";
    $("readoutMeta").textContent="Dòng chảy về "+directionText(row?.direction_toward_deg);
  }else{
    const score=num(row?.convective_score);
    $("readoutSource").textContent="HIMAWARI · MÂY";
    $("readoutValue").textContent=fmt(score,0);$("readoutUnit").textContent="/100";
    $("readoutMeta").textContent=score>=75?"Vùng mây rất cao, có thể kèm mưa dông":score>=50?"Mây cao đang phát triển":"Chưa thấy vùng mây mạnh rõ";
  }
}

function configureTimeline(){
  stopTimer();
  const slider=$("timeSlider");
  $("playBtn").disabled=false;
  slider.disabled=false;
  if(state.layer==="rain24"){
    slider.min=0;slider.max=0;slider.step=1;slider.value=0;slider.disabled=true;
    $("playBtn").disabled=true;
    $("timelineTicks").innerHTML='<span>NOW</span><span>+24H</span>';
    $("timeLabel").textContent="NEXT 24H";
  }else if(state.layer==="current"){
    slider.min=0;slider.max=0;slider.step=1;slider.value=0;slider.disabled=true;
    $("playBtn").disabled=true;
    $("timelineTicks").innerHTML='<span>NEAR-NOW</span>';
    $("timeLabel").textContent=state.marine?.current?.sampled_time?localStamp(state.marine.current.sampled_time,false):"NOW";
  }else if(state.layer==="storm"){
    const fs=cloudFrames();slider.min=0;slider.max=Math.max(0,fs.length-1);slider.step=1;state.frameIndex=clamp(state.frameIndex,0,Math.max(0,fs.length-1));slider.value=state.frameIndex;
    $("timelineTicks").innerHTML=fs.map(f=>"<span>"+localStamp(f.sampled_time,false)+"</span>").join("");
    $("timeLabel").textContent=fs[state.frameIndex]?localStamp(fs[state.frameIndex].sampled_time,false):"NOW";
  }else if(state.layer==="radar"){
    const fs=state.radarMeta?.frames||[];slider.min=0;slider.max=Math.max(0,fs.length-1);slider.step=1;slider.value=state.radarIndex;
    $("timelineTicks").innerHTML=fs.length?'<span>-60m</span><span>-40m</span><span>-20m</span><span>NOW</span>':"";
    $("timeLabel").textContent="NOW";
  }else{
    const fs=baseFrames();
    slider.min=0;slider.max=Math.max(0,fs.length-1);slider.step=1;state.frameIndex=clamp(state.frameIndex,0,Math.max(0,fs.length-1));slider.value=state.frameIndex;
    const idxs=[0,Math.floor((fs.length-1)*.25),Math.floor((fs.length-1)*.5),Math.floor((fs.length-1)*.75),fs.length-1].filter((v,i,a)=>a.indexOf(v)===i);
    $("timelineTicks").innerHTML=idxs.map(i=>"<span>"+(fs[i]?dayLabel(fs[i].valid_time):"-")+"</span>").join("");
    const f=fs[state.frameIndex];$("timeLabel").textContent=f?localStamp(f.valid_time):"NOW";
  }
  updateConfidence();
}
function selectNearestNowFrame(){
  const fs=baseFrames();if(!fs.length){state.frameIndex=0;return}
  let best=0,d=Infinity;
  fs.forEach((f,i)=>{const dd=Math.abs(parseTime(f.valid_time)-Date.now());if(dd<d){d=dd;best=i}});
  state.frameIndex=best;
}

function stopTimer(){
  if(state.timer){clearInterval(state.timer);state.timer=null}
  state.cloudTween=0;
  $("playBtn").textContent="▶";
}
function togglePlay(){
  if(state.timer){stopTimer();return}
  $("playBtn").textContent="❚❚";
  if(state.layer==="radar"){
    state.timer=setInterval(()=>{showRadar((state.radarIndex+1)%(state.radarMeta?.frames?.length||1));$("timeSlider").value=state.radarIndex},800);
  }else if(state.layer==="storm"){
    const max=Number($("timeSlider").max)||0;
    state.cloudTween=0;
    state.timer=setInterval(()=>{
      state.cloudTween++;
      if(state.cloudTween>5){
        state.cloudTween=0;
        state.frameIndex=state.frameIndex>=max?0:state.frameIndex+1;
        $("timeSlider").value=state.frameIndex;
        const f=cloudFrames()[state.frameIndex];
        $("timeLabel").textContent=f?localStamp(f.sampled_time):"NOW";
      }
      renderField();
      updateReadout();
    },150);
  }else{
    const max=Number($("timeSlider").max)||0;
    state.timer=setInterval(()=>{
      state.frameIndex=state.frameIndex>=max?0:state.frameIndex+1;
      $("timeSlider").value=state.frameIndex;
      renderAll(false);
    },650);
  }
}

async function selectLayer(layer){
  state.layer=layer;
  applyPresentationScene();
  $("probe").classList.add("hidden");
  document.querySelectorAll(".layer").forEach(b=>b.classList.toggle("active",b.dataset.layer===layer));
  clearRadar();stopParticles();stopTimer();
  if(layer==="radar"){
    try{
      await loadRadar();
      configureTimeline();
      showRadar(state.radarIndex);
      togglePlay();
    }catch(e){console.warn(e)}
  }else{
    if(layer==="current"||layer==="rain24")state.frameIndex=0;
    else if(layer!=="storm")selectNearestNowFrame();
    else state.frameIndex=Math.max(0,cloudFrames().length-1);
    configureTimeline();
  }
  renderAll();
  if(layer==="storm"&&cloudFrames().length>1)togglePlay();
}

function renderAll(redrawTimeline=true){
  applyPresentationScene();
  renderField();
  renderUncertainty();
  stopParticles();
  clearCanvas("flowCanvas");

  // V5.6: each weather layer gets its own visual grammar.
  if(state.layer==="wind")startParticles(activeRows(),"wind");
  if(state.layer==="waves")startParticles(activeRows(),"waves");
  if(state.layer==="current")startParticles(activeRows(),"current");
  // Rain = color field only. Cloud = Himawari cloud mass only.

  renderRisk();renderActual();renderScale();updateReadout();updateModelBadge();updateConfidence();updateModelDiffControl();
  if(state.flagMarker)updateSelectionFlag();
  if(redrawTimeline&&state.layer!=="radar")configureTimeline();
}

function updateModelBadge(){
  if(state.layer==="rain24"){
    $("modelName").textContent="ECMWF 24H";
    $("modelRun").textContent=state.ecmwf?.run_time?localStamp(state.ecmwf.run_time):"-";
    return;
  }
  if(state.layer==="storm"){
    $("modelName").textContent="HIMAWARI";$("modelRun").textContent=state.nowcast?.sampled_time?localStamp(state.nowcast.sampled_time):"-";return;
  }
  if(state.layer==="radar"){
    $("modelName").textContent="RADAR";$("modelRun").textContent="RainViewer";return;
  }
  if(state.layer==="current"){
    $("modelName").textContent="COPERNICUS";
    $("modelRun").textContent=state.marine?.current?.sampled_time?localStamp(state.marine.current.sampled_time):"-";
    return;
  }
  if(state.layer==="waves"&&isNearNowMarine()&&marineWaveRows().length){
    $("modelName").textContent="COPERNICUS WAVE";
    $("modelRun").textContent=state.marine?.wave?.sampled_time?localStamp(state.marine.wave.sampled_time):"-";
    return;
  }
  if(activeECMWFFrame()){
    $("modelName").textContent="ECMWF";$("modelRun").textContent=state.ecmwf?.run_time?localStamp(state.ecmwf.run_time):"-";
  }else{
    $("modelName").textContent="GEFS P50";$("modelRun").textContent=state.gefs?.run_time?localStamp(state.gefs.run_time):"-";
  }
}

function flagMetric(lat,lon){
  if(state.layer==="radar"){
    const frame=state.radarMeta?.frames?.[state.radarIndex];
    return {value:"Radar",unit:"",sub:frame?localStamp(new Date(frame.time*1000).toISOString(),false):"NOW"};
  }
  const row=nearestRow(state.currentRows,lat,lon);
  if(state.layer==="wind"){
    const control=productionMetric(state.selected.anchor,"wind");
    return {value:fmt(control??row?.wind_kmh,0),unit:"km/h",sub:"Gió từ "+directionText(row?.wind_direction_deg)};
  }
  if(state.layer==="rain")return {value:fmt(row?.rain_mm,1),unit:"mm",sub:"Rain"};
  if(state.layer==="rain24")return {value:fmt(row?.rain24_mm,1),unit:"mm",sub:"ECMWF · next 24h"};
  if(state.layer==="waves")return {value:fmt(validWaveHs(row?.wave_hs_m),1),unit:"m",sub:"Sóng từ "+directionText(row?.wave_direction_deg)};
  if(state.layer==="current")return {value:fmt(row?.speed_kmh,2),unit:"km/h",sub:"Chảy về "+directionText(row?.direction_toward_deg)};
  return {value:fmt(row?.convective_score,0),unit:"/100",sub:"Cloud"};
}
function updateSelectionFlag(){
  if(!state.flagMarker)return;
  const ll=state.flagMarker.getLatLng();
  const metric=flagMetric(ll.lat,ll.lng);
  const anchor=state.selected.anchor;
  const place=POINTS[anchor]?.name||"Điểm chọn";
  const icon=L.divIcon({
    className:"",
    html:'<div class="windy-flag"><div class="windy-flag-place">'+esc(place)+'</div><div class="windy-flag-value">'+esc(metric.value)+' <small>'+esc(metric.unit)+'</small></div><div class="windy-flag-sub">'+esc(metric.sub)+' · chạm để xem chi tiết</div><i></i></div>',
    iconSize:[142,72],
    iconAnchor:[22,78]
  });
  state.flagMarker.setIcon(icon);
}
function showSelectionFlag(lat,lon,anchor=nearestAnchor(lat,lon)){
  state.selected={lat,lon,anchor};
  $("probe").classList.add("hidden");
  updateReadout();updateConfidence();
  if(state.flagMarker)state.map.removeLayer(state.flagMarker);
  state.flagMarker=L.marker([lat,lon],{
    icon:L.divIcon({className:"",html:"",iconSize:[142,72],iconAnchor:[22,78]}),
    zIndexOffset:1700
  }).addTo(state.map);
  state.flagMarker.on("click",e=>{
    L.DomEvent.stopPropagation(e);
    showMapProbe(lat,lon);
  });
  updateSelectionFlag();
}
function selectAnchorFlag(id){
  const p=POINTS[id];
  if(!p)return;
  showSelectionFlag(p.lat,p.lon,id);
}
function showActualFlag(name,g,lat,lon){
  $("probe").classList.add("hidden");
  if(state.flagMarker)state.map.removeLayer(state.flagMarker);
  const isWind=g.wind_kmh!==undefined;
  const value=isWind?fmt(g.wind_kmh,0):fmt(g.rain_intensity_mm_h??g.accum_mm,1);
  const unit=isWind?"km/h":(g.rain_intensity_mm_h!=null?"mm/h":"mm");
  const sub=isWind?"Actual wind":"Actual rain";
  const icon=L.divIcon({
    className:"",
    html:'<div class="windy-flag actual-flag"><div class="windy-flag-place">'+esc(name)+'</div><div class="windy-flag-value">'+esc(value)+' <small>'+esc(unit)+'</small></div><div class="windy-flag-sub">'+esc(sub)+' · chạm để xem chi tiết</div><i></i></div>',
    iconSize:[142,72],
    iconAnchor:[22,78]
  });
  state.flagMarker=L.marker([lat,lon],{icon,zIndexOffset:1800}).addTo(state.map);
  state.flagMarker.on("click",e=>{
    L.DomEvent.stopPropagation(e);
    showActualProbe(name,g);
  });
}
function showProbe(title,source,items,extra){
  $("probe").classList.remove("hidden");$("probeTitle").textContent=title;$("probeSource").textContent=source;
  $("probeGrid").innerHTML=items.map(x=>'<div class="probe-item"><span>'+esc(x[0])+'</span><b>'+esc(x[1])+'</b></div>').join("");
  $("probeExtra").textContent=extra||"";
}
function ensembleAt(lat,lon){
  if(!state.gefs)return null;
  const f=nearestFrame(gefsFrames(),activeValidTime()||Date.now());
  if(!f)return null;
  let best=null,d=Infinity;
  (f.cells||[]).forEach(c=>{
    const la=cellLat(c.cell_id),lo=cellLon(c.cell_id),dd=distance2(la,lo,lat,lon);
    if(dd<d){d=dd;best=c}
  });
  return best;
}
function showMapProbe(lat,lon){
  const row=nearestRow(state.currentRows,lat,lon);
  const ens=ensembleAt(lat,lon);
  const anchor=nearestAnchor(lat,lon),p=state.critical?.points?.[anchor]||{},l=p.local||{},m=p.model||{},t=p.tide||{},aq=p.aqi||{};
  const items=[];
  if(state.layer==="wind"){
    const icon=nearestRow(iconRows(),lat,lon);
    const productionControl=productionMetric(anchor,"wind");
    const ecmwfWind=productionControl??num(row?.wind_kmh),iconWind=num(icon?.wind_kmh);
    const iconDelta=ecmwfWind!==null&&iconWind!==null?Math.abs(ecmwfWind-iconWind):null;
    const disagreement=windDisagreement(ecmwfWind,ens);
    items.push(
      ["ECMWF control",fmt(ecmwfWind,0)+" km/h"],
      ["Hướng",directionWithDegrees(row?.wind_direction_deg)],
      ["ICON",fmt(iconWind,0)+" km/h"],
      ["Δ ECMWF↔ICON",iconDelta===null?"Chưa có":fmt(iconDelta,0)+" km/h"],
      ["GEFS q50",fmt(ens?.wind?.q50,0)+" km/h"],
      ["GEFS q90 · đuôi rủi ro",fmt(ens?.wind?.q90,0)+" km/h"],
      ["GEFS q95",fmt(ens?.wind?.q95,0)+" km/h"],
      ["P(gió ≥30)",ens?.wind?.prob==null?"Chưa có":Math.round(ens.wind.prob*100)+"%"],
      ["Mức đồng thuận",disagreementLabel(disagreement.level)]
    );
  }
  else if(state.layer==="rain")items.push(
    ["ECMWF",fmt(row?.rain_mm,1)+" mm"],
    ["GEFS p50",fmt(ens?.rain?.q50,1)+" mm"],
    ["GEFS p90",fmt(ens?.rain?.q90,1)+" mm"],
    ["GEFS p95",fmt(ens?.rain?.q95,1)+" mm"],
    ["P ≥5",ens?.rain?.prob==null?"-":Math.round(ens.rain.prob*100)+"%"],
    ["Spread",fmt(ens?.rain?.spread,1)+" mm"]
  );
  else if(state.layer==="rain24")items.push(
    ["ECMWF next 24h",fmt(row?.rain24_mm,1)+" mm"],
    ["Loại dữ liệu","Forecast accumulation"],
    ["Actual 24h","Chưa có grid quan trắc liên tục"],
    ["Lưu ý","Không nội suy VRain thành raster actual"]
  );
  else if(state.layer==="waves")items.push(["Hs",fmt(validWaveHs(row?.wave_hs_m),1)+" m"],["Sóng từ",directionWithDegrees(row?.wave_direction_deg)],["Chu kỳ",fmt(validWavePeriod(row?.wave_period_s??row?.wave_mean_period_s??row?.wave_peak_period_s),1)+" s"],["Hmax anchor",fmt(m.wave_hmax_m,1)+" m"]);
  else if(state.layer==="current")items.push(["Dòng",fmt(row?.speed_kmh,2)+" km/h"],["Chảy về",directionWithDegrees(row?.direction_toward_deg)],["U",fmt(row?.u_ms,3)+" m/s"],["V",fmt(row?.v_ms,3)+" m/s"]);
  else items.push(["Đối lưu",fmt(row?.convective_score,0)+"/100"],["Đỉnh mây",fmt(row?.cloud_top_cold_c,1)+"°C"],["Độ cao",fmt(row?.cloud_top_high_m,0)+" m"],["Δ20p",fmt(row?.cooling_c_per_20m_proxy,1)+"°C"]);
  const regional=regionalForecastRow();
  const extra=(POINTS[anchor]?.name||anchor)+
    " · Local Now gió "+fmt(l.wind_kmh,0)+" km/h"+
    " · Hmax "+fmt(m.wave_hmax_m,1)+" m"+
    " · dòng "+fmt(m.current_kmh,2)+" km/h"+
    " · triều "+fmt(t.height_m,2)+" m"+
    " · AQI "+fmt(aq.aqi_us,0)+
    (regional?" · confidence "+fmt(regional.confidence_score,0)+"/100 · variability "+fmt(regional.variability_score,0)+"/100":"");
  showProbe("Điểm trên bản đồ",state.layer==="storm"?"HIMAWARI":"SPATIAL + ENSEMBLE",items,extra);
}
function showAnchorProbe(id){
  const p=state.critical?.points?.[id]||{},l=p.local||{},m=p.model||{},t=p.tide||{},aq=p.aqi||{},r=riskAt(id);
  state.selected={lat:POINTS[id].lat,lon:POINTS[id].lon,anchor:id};updateReadout();updateConfidence();
  showProbe(POINTS[id].name,"OPERATIONAL ANCHOR",[
    ["Risk",riskLabel(r.level)],["Local wind",fmt(l.wind_kmh,0)+" km/h"],["Rain",fmt(l.rain_rate_mm_h,2)+" mm/h"],["Hs",fmt(l.wave_hs_m??m.wave_hs_m,1)+" m"],
    ["Hmax",fmt(m.wave_hmax_m,1)+" m"],["Current",fmt(m.current_kmh,2)+" km/h"],["Tide",fmt(t.height_m,2)+" m"],["AQI",fmt(aq.aqi_us,0)]
  ],r.reasons.join(" · ")||"Không có cảnh báo nổi bật.");
}
function showActualProbe(name,g){
  const items=[];
  if(g.wind_kmh!==undefined)items.push(["Gió",fmt(g.wind_kmh,0)+" km/h"]);
  if(g.temperature_c!==undefined)items.push(["Nhiệt",fmt(g.temperature_c,1)+"°C"]);
  if(g.accum_mm!==undefined)items.push(["Tích lũy",fmt(g.accum_mm,1)+" mm"]);
  if(g.rain_intensity_mm_h!==undefined&&g.rain_intensity_mm_h!==null)items.push(["Cường độ",fmt(g.rain_intensity_mm_h,1)+" mm/h"]);
  showProbe(name,"ACTUAL",items,g.observed_at?localStamp(g.observed_at):"");
}

function onMapClick(e){
  if(state.crosshair){
    state.map.panTo(e.latlng,{animate:true,duration:.25});
    return;
  }
  showSelectionFlag(e.latlng.lat,e.latlng.lng,nearestAnchor(e.latlng.lat,e.latlng.lng));
}

function renderAlert(){
  const root=$("alertBar");
  if(!state.critical){$("alertTitle").textContent="Weather Lab chưa tải";return}
  const ids=state.critical.island_watch_order||Object.keys(POINTS);
  const rows=ids.filter(id=>state.critical.points?.[id]).map(id=>({id,r:riskAt(id)})).sort((a,b)=>b.r.level-a.r.level);
  const w=rows[0];
  root.className="alert-bar neutral";$("alertTitle").textContent="Chưa thấy tín hiệu vượt ngưỡng chính";$("alertTime").textContent=currentLeadHours()>0?"+"+Math.round(currentLeadHours())+"H":"LIVE";
  if(w?.r.level>=2){
    root.className="alert-bar "+(w.r.level>=3?"alert":"watch");
    $("alertTitle").textContent=(POINTS[w.id]?.name||w.id)+" · "+(w.r.reasons[0]||"cần theo dõi");
  }
}

function setStatus(){
  const missing=[];
  if(!state.ecmwf)missing.push("ECMWF");
  if(!state.gefs)missing.push("GEFS");
  if(!state.nowcast)missing.push("Himawari");
  const el=$("dataStatus").parentElement;
  if(!missing.length){el.className="status-pill live";$("dataStatus").textContent="ĐANG HOẠT ĐỘNG"}
  else{el.className="status-pill warn";$("dataStatus").textContent="THIẾU "+missing.join("/")}
}
function sourceFreshness(){
  const parts=[];
  if(state.ecmwf?.generated_at)parts.push("ECMWF "+ageText(state.ecmwf.generated_at));
  if(state.icon?.generated_at)parts.push("ICON spatial");
  if(state.gefs?.generated_at)parts.push("GEFS "+ageText(state.gefs.generated_at));
  if(state.nowcast?.sampled_time)parts.push("Himawari "+ageText(state.nowcast.sampled_time));
  if(state.marine?.generated_at)parts.push("Marine "+ageText(state.marine.generated_at));
  return parts.join(" · ");
}

async function loadAll(){
  if(state.loading)return;state.loading=true;
  const [production,ecmwf,icon,marine,gefs,nowcast,critical,forecast,current,feedback]=await Promise.all([
    optional(URLS.production),optional(URLS.ecmwf),optional(URLS.icon),optional(URLS.marine),optional(URLS.gefs),optional(URLS.nowcast),optional(URLS.critical),optional(URLS.forecast),optional(URLS.current),optional(URLS.feedback)
  ]);
  state.production=production;state.ecmwf=ecmwf;state.icon=icon;state.marine=marine;state.gefs=gefs;
  state.nowcast=nowcast;state.critical=critical;state.forecast=forecast;
  state.currentBundle=current;state.fieldFeedback=feedback;
  if(state.critical&&state.currentBundle)overlayCurrentBundle(state.critical,state.currentBundle);
  setStatus();
  if(state.ecmwf)selectNearestNowFrame();
  renderAlert();
  renderRisk();renderActual();
  renderAll();
  $("readoutMeta").title=sourceFreshness();
  state.loading=false;
}

function bind(){
  document.querySelectorAll(".layer").forEach(b=>b.addEventListener("click",()=>selectLayer(b.dataset.layer)));
  $("ensembleBtn").addEventListener("click",()=>{
    state.ensemble=!state.ensemble;
    if(state.ensemble&&state.modelDiff){state.modelDiff=false;$("modelDiffBtn").classList.remove("active")}
    $("ensembleBtn").classList.toggle("active",state.ensemble);
    renderUncertainty();
  });
  $("modelDiffBtn").addEventListener("click",()=>{
    if(!modelDiffAvailable())return;
    state.modelDiff=!state.modelDiff;
    if(state.modelDiff&&state.ensemble){state.ensemble=false;$("ensembleBtn").classList.remove("active")}
    $("modelDiffBtn").classList.toggle("active",state.modelDiff);
    renderUncertainty();
  });
  $("riskBtn").addEventListener("click",()=>{state.risk=!state.risk;$("riskBtn").classList.toggle("active",state.risk);renderRisk()});
  $("actualBtn").addEventListener("click",()=>{state.actual=!state.actual;$("actualBtn").classList.toggle("active",state.actual);renderActual()});
  $("crosshairBtn").addEventListener("click",()=>setCrosshair(!state.crosshair));
  $("recenterBtn").addEventListener("click",()=>state.map.setView([10.17,103.98],10.15,{animate:true}));
  $("probeClose").addEventListener("click",()=>$("probe").classList.add("hidden"));
  $("playBtn").addEventListener("click",togglePlay);
  $("timeSlider").addEventListener("input",e=>{
    stopTimer();
    $("probe").classList.add("hidden");
    if(state.layer==="radar"){showRadar(Number(e.target.value));state.radarIndex=Number(e.target.value);return}
    state.frameIndex=Number(e.target.value);
    renderAll(false);
    const f=state.layer==="storm"?cloudFrames()[state.frameIndex]:activeECMWFFrame();
    $("timeLabel").textContent=f?localStamp(f.valid_time||f.sampled_time):"NOW";
    renderAlert();
  });
  addEventListener("resize",()=>{renderField();renderUncertainty();resetParticles()},{passive:true});
}

async function start(){
  if(EMBED)document.body.classList.add("embed-mode");
  initMap();bind();setCrosshair(true);applyPresentationScene();await loadAll();
  setInterval(async()=>{
    const [nowcast,marine,critical,forecast,current,feedback]=await Promise.all([
      optional(URLS.nowcast),optional(URLS.marine),optional(URLS.critical),optional(URLS.forecast),optional(URLS.current),optional(URLS.feedback)
    ]);
    if(nowcast)state.nowcast=nowcast;
    if(marine)state.marine=marine;
    if(critical)state.critical=critical;
    if(forecast)state.forecast=forecast;
    if(current)state.currentBundle=current;
    if(feedback)state.fieldFeedback=feedback;
    if(state.critical&&state.currentBundle)overlayCurrentBundle(state.critical,state.currentBundle);
    setStatus();renderAlert();renderRisk();renderActual();renderAll(false);
  },2*60*1000);
}

if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start);else start();
})();