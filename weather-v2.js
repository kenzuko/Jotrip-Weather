(()=>{
"use strict";

const CRITICAL="/data/critical.json";
const LOCAL_NOW="/data/local-now.json";
const GROUND_TRUTH="/data/groundtruth.json";
const CURRENT_BUNDLE="/data/current-bundle.json";
const TIDE=["/data/tide.json","https://raw.githubusercontent.com/kenzuko/Jotrip-Lab/feat/weather-lab-data-engine-v1/weather/tide.json"];
const AQI=["/data/air-quality.json","https://raw.githubusercontent.com/kenzuko/Jotrip-Lab/data-weather/data/weather-aqi/latest.json"];
const NOWCAST=["https://jotrip-weather-fresh.kenzuko.workers.dev/nowcast-compact.json","/data/nowcast-compact.json"];
const FRESH_BUNDLE="https://jotrip-weather-fresh.kenzuko.workers.dev/current-bundle.json";
const JOTRIP_FORECAST="/data/jotrip-forecast.json";
const ENGINE_DASHBOARD="/data/dashboard-data.json";
const RUNTIME_AUTHORITY="/data/runtime-authority.json";
const LIVE_REFRESH_MS=2*60*1000;
const LIVE_NO_STORE_URLS=[CRITICAL,LOCAL_NOW,GROUND_TRUTH,CURRENT_BUNDLE,JOTRIP_FORECAST,ENGINE_DASHBOARD,RUNTIME_AUTHORITY,FRESH_BUNDLE,...NOWCAST];
const WEATHER_LIVE_API="https://jotrip-weather-live.kenzuko.workers.dev";
const FEEDBACK_ENDPOINT=WEATHER_LIVE_API+"/feedback";
const RECENT_FEEDBACK_ENDPOINT=WEATHER_LIVE_API+"/feedback/recent?minutes=90&limit=30";
const FEEDBACK_QUEUE_KEY="pq_weather_feedback_queue_v1";
const FEEDBACK_HISTORY_KEY="pq_weather_field_feedback_v1";
const WINDY={
  radar:"https://embed.windy.com/embed2.html?lat=10.20&lon=104.00&detailLat=10.20&detailLon=104.00&width=1000&height=650&zoom=8&level=surface&overlay=radar&product=radar&menu=&message=true&marker=true&calendar=now&pressure=&type=map&location=coordinates&detail=&metricWind=km%2Fh&metricTemp=%C2%B0C&radarRange=-1",
  wind:"https://embed.windy.com/embed2.html?lat=10.20&lon=104.00&detailLat=10.20&detailLon=104.00&width=1000&height=650&zoom=8&level=surface&overlay=wind&product=ecmwf&menu=&message=true&marker=true&calendar=now&pressure=&type=map&location=coordinates&detail=&metricWind=km%2Fh&metricTemp=%C2%B0C",
  rain:"https://embed.windy.com/embed2.html?lat=10.20&lon=104.00&detailLat=10.20&detailLon=104.00&width=1000&height=650&zoom=8&level=surface&overlay=rain&product=ecmwf&menu=&message=true&marker=true&calendar=now&pressure=&type=map&location=coordinates&detail=&metricWind=km%2Fh&metricTemp=%C2%B0C",
  waves:"https://embed.windy.com/embed2.html?lat=10.20&lon=104.00&detailLat=10.20&detailLon=104.00&width=1000&height=650&zoom=8&level=surface&overlay=waves&product=ecmwfWaves&menu=&message=true&marker=true&calendar=now&pressure=&type=map&location=coordinates&detail=&metricWind=km%2Fh&metricTemp=%C2%B0C"
};
const JMA="https://www.data.jma.go.jp/mscweb/data/himawari/img/ha1/";

const $=id=>document.getElementById(id);
const num=v=>v===null||v===undefined||v===""||Number.isNaN(Number(v))?null:Number(v);
const fmt=(v,d=1)=>{v=num(v);return v===null?"-":Number(v.toFixed(d)).toString()};
const esc=v=>String(v??"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
const defer=(fn,ms=600)=>setTimeout(()=>{"requestIdleCallback" in window?requestIdleCallback(()=>fn(),{timeout:900}):fn()},ms);
function isoUTC7(value=Date.now()){
  const d=value instanceof Date?value:new Date(value);
  if(Number.isNaN(d.getTime()))return null;
  return new Date(d.getTime()+7*3600000).toISOString().replace("Z","+07:00");
}

let critical=null;
let current="duong_dong";
let currentBundle=null;
let intradayLayer="wind";
let fullAQI=null;
let fullTide=null;
let fullNowcast=null;
let regionalForecast=null;
let engineDashboard=null;
let selectedForecastDayKey=null;
let currentRegion="central_west";
const POINT_REGION={
  duong_dong:"central_west",
  cua_can:"north_northwest",ganh_dau:"north_northwest",
  bai_thom:"east_northeast",ham_ninh:"east_northeast",
  bai_sao:"south_southeast",an_thoi:"south_southeast"
};
function regionForPoint(id){return POINT_REGION[id]||null}
let mapStarted=false;
let mapLayer="jotrip";
let jotripMap=null;
let leafletPromise=null;
let liveRefreshBusy=false;
let lastLiveRefreshAt=0;
let recentFieldFeedback=null;
let himawariLoopTimer=null;
let himawariLoopPlaying=true;
let himawariMap=null;
let himawariOverlay=null;
const HIMAWARI_HA1_BOUNDS=[[7.0,99.0],[16.0,110.0]];

async function getJSON(url,ttlMs=120000){
  const sep=url.includes("?")?"&":"?";
  const live=LIVE_NO_STORE_URLS.includes(url);
  const token=live?Date.now():Math.floor(Date.now()/Math.max(30000,ttlMs));
  const r=await fetch(url+sep+"v="+token,{cache:live?"no-store":"default"});
  if(!r.ok)throw new Error("HTTP "+r.status);
  return r.json();
}
async function getFirst(urls,ttlMs=120000){
  let last;
  for(const u of urls){
    try{return await getJSON(u,ttlMs)}catch(e){last=e}
  }
  throw last||new Error("unavailable");
}
function ageMinutes(iso){
  const t=Date.parse(iso||"");
  return Number.isFinite(t)?Math.max(0,(Date.now()-t)/60000):Infinity;
}
function liveTimestamp(){
  return critical?.local_generated_at||critical?.generated_at||null;
}
function localDataFresh(maxMinutes=35){
  return freshEnough(liveTimestamp(),maxMinutes);
}
function sourceAgeLabel(iso,limit){
  const age=ageMinutes(iso);
  if(!Number.isFinite(age))return "không rõ";
  return (age<=limit?"MỚI · ":"TRỄ · ")+ageText(iso);
}
function actualTimestamp(){return critical?.actual?.vvpq?.observed_at||null}
function nowcastTimestamp(){return fullNowcast?.sampled_time||effectiveNowcast()?.sampled_time||null}
function forecastTimestamp(){return engineDashboard?.generated_at||regionalForecast?.generated_at||critical?.generated_at||null}
function ageText(iso){
  const m=ageMinutes(iso);
  if(!Number.isFinite(m))return "không rõ";
  if(m<2)return "vừa cập nhật";
  if(m<60)return Math.round(m)+" phút trước";
  const h=Math.floor(m/60),rest=Math.round(m-h*60);
  if(rest>=60)return (h+1)+" giờ trước";
  if(rest<8)return h+" giờ trước";
  return h+" giờ "+rest+" phút trước";
}
function localTime(iso){
  const d=new Date(iso);
  return Number.isFinite(d.getTime())?d.toLocaleString("vi-VN",{timeZone:"Asia/Ho_Chi_Minh",day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}):"-";
}
function hourLabel(iso){
  const d=new Date(iso);
  return Number.isFinite(d.getTime())?d.toLocaleString("vi-VN",{timeZone:"Asia/Ho_Chi_Minh",weekday:"short",hour:"2-digit",minute:"2-digit",hour12:false}):"-";
}
function badgeClass(k){
  k=String(k||"").toUpperCase();
  if(k==="ACTUAL"||k==="POINT_NUMERIC_READY"||k==="READY")return "actual";
  if(k==="ESTIMATED_NOW")return "estimated";
  if(k==="REMOTE_OBSERVED")return "remote";
  if(k==="MODEL_ONLY")return "model";
  if(k==="LEARNING")return "learning";
  return "deferred";
}
function setBadge(id,k,label){
  const el=$(id);if(!el)return;
  el.className="badge "+badgeClass(k);
  const key=String(k||"").toUpperCase();
  const natural={
    ACTUAL:"ĐO THỰC",ESTIMATED_NOW:"ƯỚC TÍNH",MODEL_ONLY:"MÔ HÌNH",
    REMOTE_OBSERVED:"VỆ TINH",LEARNING:"ĐANG HIỆU CHỈNH",
    READY:"SẴN SÀNG",UNAVAILABLE:"CHƯA CÓ"
  };
  el.textContent=label||natural[key]||String(k||"-").replace("_NOW","").replaceAll("_"," ");
}
function setMetric(id,v,d){const el=$(id);if(el)el.textContent=num(v)===null?"-":fmt(v,d)}
function point(){return critical?.points?.[current]||{}}
function localPoint(){return point().local||{}}
function dashboardModelPoint(id=current){
  const p=engineDashboard?.points?.[id]||{};
  if(!p||!Object.keys(p).length)return null;
  return {
    temperature_c:num(p.temperature),
    wind_kmh:num(p.wind),
    gust_kmh:num(p.gust),
    rain_3h_mm:num(p.rain),
    wave_hs_m:num(p.wave),
    wave_hmax_m:num(p.wave_max),
    period_s:num(p.period),
    current_kmh:num(p.current),
    wave_regional_hs_m:num(p.wave_regional_hs),
    marine_sampled_time:p.marine_sampled_time||null,
    wave_max_method:p.wave_max_method||null,
    long_range_status:p.long_range_status||null
  };
}
function modelPoint(){
  const compact=point().model||{};
  if(!critical?._forecast_baseline_stale)return compact;
  return dashboardModelPoint()||compact;
}
function forecastCycleCompatible(forecast,dashboard){
  const ft=Date.parse(forecast?.run_time||"");
  const dt=Date.parse(dashboard?.source_cycles?.GEFS||"");
  if(!Number.isFinite(ft)||!Number.isFinite(dt))return true;
  return ft+5*60*1000>=dt;
}
function refreshSnapshotAuthority(){
  if(!critical||!engineDashboard)return true;
  const cs=critical.snapshot_id||null,ds=engineDashboard.snapshot_id||null;
  const mismatch=Boolean(cs&&ds&&cs!==ds);
  critical._forecast_baseline_stale=mismatch;
  if(mismatch){
    console.warn("[Weather V2] snapshot mismatch; using dashboard as model authority",{critical:cs,dashboard:ds});
  }
  if(regionalForecast&&!forecastCycleCompatible(regionalForecast,engineDashboard)){
    console.warn("[Weather V2] stale regional forecast rejected",{
      forecast:regionalForecast.run_time,
      engine:engineDashboard.source_cycles?.GEFS
    });
    regionalForecast=null;
    return false;
  }
  return !mismatch;
}
function overlayFreshLocalNow(base,localNow){
  if(!base||!localNow?.points)return base;
  const localTs=Date.parse(localNow.generated_at||"");
  const baseTs=Date.parse(base.local_generated_at||"");
  if(Number.isFinite(baseTs)&&Number.isFinite(localTs)&&localTs<baseTs)return base;
  base.local_generated_at=localNow.generated_at||base.local_generated_at;
  base.source_state={...(base.source_state||{}),local_engine:localNow.engine||base.source_state?.local_engine};
  Object.entries(localNow.points).forEach(([id,lp])=>{
    const bp=base.points?.[id];if(!bp||!lp)return;
    const rain=lp.rain||{},wind=lp.wind||{},temp=lp.temperature||{},marine=lp.marine||{};
    bp.local={...(bp.local||{}),
      available:true,
      temperature_c:num(lp.temperature_c),
      wind_kmh:num(lp.wind_kmh),
      wind_direction_deg:num(lp.wind_direction_deg),
      rain_rate_mm_h:num(rain.rain_rate_mm_h),
      rain_confidence:num(rain.confidence),
      rain_imminence_score:num(rain.imminence?.score),
      rain_imminence_level:rain.imminence?.level||null,
      rain_imminence_window_min:num(rain.imminence?.window_minutes),
      rain_imminence_motion:rain.imminence?.cloud_motion||null,
      rain_impact_label:rain.imminence?.rain_impact_label||rain.rain_impact_label||null,
      rain_impact_background_mm_h:num(rain.imminence?.background_model_rate_mm_h??rain.background_model_rate_mm_h),
      convection_score:num(rain.convective_score),
      wave_hs_m:num(lp.wave_hs_m),
      temperature_class:temp.data_class||bp.local?.temperature_class,
      wind_class:wind.data_class||bp.local?.wind_class,
      rain_class:rain.data_class||bp.local?.rain_class,
      marine_class:marine.data_class||bp.local?.marine_class,
      analysis_time:lp.analysis_time||localNow.generated_at||null,
      reference_lat:num(lp.lat),
      reference_lon:num(lp.lon),
      wind_method:wind.method||null
    };
  });
  return base;
}
function overlayFreshGroundTruth(base,ground){
  if(!base||!ground)return base;
  base._groundtruth=ground;
  const actual=base.actual={...(base.actual||{})};
  const v=ground.atmosphere?.vvpq||{};
  if(v.status){
    actual.vvpq={
      status:v.status,
      observed_at:v.observed_at,
      lat:num(v.lat),
      lon:num(v.lon),
      temperature_c:num(v.temperature_c),
      wind_kmh:num(v.wind_speed_kmh),
      wind_direction_deg:num(v.wind_direction_deg),
      pressure_hpa:num(v.pressure_hpa),
      visibility_m:num(v.visibility_m),
      weather:v.weather||null,
      convective_cloud:Boolean(v.convective_cloud)
    };
    base.source_state={...(base.source_state||{}),vvpq:v.status};
  }
  const stations=ground.rainfall?.stations||{};
  actual.rain_gauges=Object.values(stations).map(s=>({
    name:s.station_name,
    lat:num(s.lat),lon:num(s.lon),
    accum_mm:num(s.accumulation_mm),
    increment_mm:num(s.increment_mm),
    increment_min:num(s.increment_window_minutes),
    rain_observed:s.rain_observed,
    rain_intensity_mm_h:num(s.rain_intensity_mm_h),
    recent_change_mm:num(s.recent_change_mm),
    recent_change_min:num(s.recent_change_window_minutes),
    rain_recently_observed:s.rain_recently_observed,
    increment_qc:s.increment_qc,
    observed_at:s.observed_at,
    period_start:s.period_start||ground.rainfall?.period_start||null,
    period_end:s.period_end||ground.rainfall?.period_end||null,
    qc:s.qc
  }));
  if(ground.rainfall?.status)base.source_state={...(base.source_state||{}),vrain:ground.rainfall.status};
  return base;
}
async function getCriticalWithFreshLocal(){
  // The read-only Cloudflare gateway reads the SAME canonical JoTrip-Lab
  // data-weather branch. Select the newest valid snapshot, never combine
  // unrelated model baselines or treat data recency as forecast accuracy.
  const [base,mirror,edge]=await Promise.allSettled([
    getJSON(CRITICAL,2*60*1000),
    getJSON(CURRENT_BUNDLE,2*60*1000),
    getJSON(FRESH_BUNDLE,60*1000)
  ]);
  if(base.status!=="fulfilled")throw base.reason;
  critical=base.value;
  const bundles=[mirror,edge].filter(x=>x.status==="fulfilled")
    .map(x=>x.value).filter(x=>x?.local_now?.points&&x?.groundtruth);
  bundles.sort((a,b)=>Date.parse(b.local_now.generated_at||b.generated_at||0)-Date.parse(a.local_now.generated_at||a.generated_at||0));
  if(bundles.length){
    const live=bundles[0];
    currentBundle=live;
    overlayFreshLocalNow(critical,live.local_now);
    overlayFreshGroundTruth(critical,live.groundtruth);
    if(live.nowcast?.points&&(
      !fullNowcast||Date.parse(live.nowcast.sampled_time||0)>Date.parse(fullNowcast.sampled_time||0)
    ))fullNowcast=live.nowcast;
    return critical;
  }
  const [local,ground]=await Promise.allSettled([getJSON(LOCAL_NOW,2*60*1000),getJSON(GROUND_TRUTH,2*60*1000)]);
  if(local.status==="fulfilled")overlayFreshLocalNow(critical,local.value);
  if(ground.status==="fulfilled")overlayFreshGroundTruth(critical,ground.value);
  return critical;
}

function islandIds(){
  return (critical?.island_watch_order||[]).filter(id=>critical?.points?.[id]);
}
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function viLevel(v){
  return ({LOW:"THẤP",WATCH:"THEO DÕI",ELEVATED:"TĂNG",HIGH:"CAO"}[String(v||"").toUpperCase()]||String(v||""));
}
function viCal(v){
  return String(v||"").toUpperCase()==="LEARNING"?"ĐANG HIỆU CHỈNH":String(v||"").replaceAll("_"," ");
}
function sourceReady(v){
  const x=String(v||"").toUpperCase();
  return ["FRESH","READY","POINT_NUMERIC_READY","MEMBER_MATRIX_READY","PASS","LIVE"].includes(x);
}
function pointLayerCoverage(p){
  const l=p.local||{},a=p.aqi||{},t=p.tide||{},n=p.nowcast||{},e=p.ensemble||{};
  return [
    [l.temperature_c,l.wind_kmh,l.rain_rate_mm_h].every(v=>num(v)!==null),
    num(l.wave_hs_m??p.model?.wave_hs_m)!==null,
    num(a.aqi_us)!==null,
    num(t.height_m)!==null,
    num(n.convective_score)!==null,
    (e.rows||[]).length>=3
  ];
}
function coverageScore(){
  const ids=islandIds();if(!ids.length)return 0;
  let ok=0,total=0;
  ids.forEach(id=>pointLayerCoverage(critical.points[id]).forEach(v=>{total++;if(v)ok++}));
  return total?Math.round(100*ok/total):0;
}
function confidenceScore(){
  const ids=islandIds();if(!ids.length)return 0;
  const coverage=coverageScore()/100;
  const confs=ids.map(id=>num(critical.points[id]?.local?.rain_confidence)).filter(v=>v!==null);
  const local=confs.length?confs.reduce((a,b)=>a+b,0)/confs.length:0.35;
  const fresh=clamp(1-ageMinutes(liveTimestamp())/90,0,1);
  const ens=ids.map(id=>num(critical.points[id]?.ensemble?.completion_ratio)).filter(v=>v!==null);
  const ensemble=ens.length?ens.reduce((a,b)=>a+b,0)/ens.length:0;
  const g=critical.actual?.rain_gauges||[];
  const actual=(sourceReady(critical.source_state?.vvpq)?0.45:0)+(g.filter(x=>x.qc==="PASS"||num(x.accum_mm)!==null).length>=3?0.55:0);
  let score=100*(0.25*coverage+0.30*local+0.15*fresh+0.15*ensemble+0.15*actual);
  const learning=ids.some(id=>String(critical.points[id]?.ensemble?.calibration_status||"").toUpperCase()==="LEARNING");
  if(learning)score*=0.88;
  return Math.round(clamp(score,0,100));
}
function pointRisk(p,id=null){
  const m=p.model||{},legacyNow=p.nowcast||{},l=p.local||{},rows=p.ensemble?.rows||[];
  const n=id?effectiveNowcastFor(id):legacyNow;
  const localFresh=localDataFresh();
  const nowFresh=freshEnough(n?.sampled_time||fullNowcast?.sampled_time||legacyNow.sampled_time,75);
  const conv=nowFresh?num(n?.convective_score):null;
  const imminence=localFresh?num(l.rain_imminence_score):null;
  const guard=globalThis.JoTripWindGuard;
  const freshModel=guard?.dashboardUsable(engineDashboard);
  const now=Date.now();
  const nearRows=freshModel?(engineDashboard?.points?.[id]?.hours||[])
    .filter(r=>{
      const t=Date.parse(r.time_iso||"");
      return Number.isFinite(t)&&t>=now&&t<=now+3*3600000&&
        guard.validForecastFrame(r);
    }):[];
  const maxOrNull=(values)=>values.length?Math.max(...values):null;
  const gust=maxOrNull(nearRows.map(r=>num(r.gust)).filter(v=>v!==null));
  const rain=maxOrNull(nearRows.map(r=>num(r.rain)).filter(v=>v!==null));
  const hs=maxOrNull(nearRows.map(r=>num(r.wave)).filter(v=>v!==null));
  const currentWind=localFresh&&l.available?num(l.wind_kmh):null;
  const aligned=freshModel&&critical?.snapshot_id&&
    critical.snapshot_id===engineDashboard?.snapshot_id&&
    freshEnough(critical?.generated_at,150);
  const nearEns=aligned?rows.filter(r=>num(r.lead_hours)!==null&&r.lead_hours<=6):[];
  const windProb=Math.max(0,...nearEns.map(x=>num(x.wind?.prob)).filter(v=>v!==null));
  const rainProb=Math.max(0,...nearEns.map(x=>num(x.rain?.prob)).filter(v=>v!==null));
  let level=0,reasons=[];
  if(currentWind!==null&&currentWind>=40){level=Math.max(level,3);reasons.push("gió hiện tại mạnh theo ước tính địa phương")}
  else if(currentWind!==null&&currentWind>=30){level=Math.max(level,2);reasons.push("gió hiện tại cần theo dõi")}
  if(conv!==null&&conv>=75){level=Math.max(level,2);reasons.push("mây phát triển rất cao")}
  else if(conv!==null&&conv>=60){level=Math.max(level,1);reasons.push("mây đang phát triển")}
  if(imminence!==null&&imminence>=75){level=Math.max(level,2);reasons.push("mưa cục bộ có thể tăng nhanh")}
  else if(imminence!==null&&imminence>=55){level=Math.max(level,1);reasons.push("mưa ngắn hạn cần theo dõi")}
  if(gust!==null&&gust>=50){level=Math.max(level,3);reasons.push("dự báo gió giật mạnh trong 3 giờ tới")}
  else if(gust!==null&&gust>=40){level=Math.max(level,2);reasons.push("dự báo gió giật cần theo dõi trong 3 giờ tới")}
  if(rain!==null&&rain>=25){level=Math.max(level,3);reasons.push("dự báo mưa 3 giờ lớn")}
  else if(rain!==null&&rain>=10){level=Math.max(level,2);reasons.push("dự báo mưa 3 giờ tăng")}
  if(hs!==null&&hs>=2){level=Math.max(level,3);reasons.push("sóng nền dự báo cao")}
  else if(hs!==null&&hs>=1.5){level=Math.max(level,2);reasons.push("sóng nền dự báo tăng")}
  if(windProb>=0.25){level=Math.max(level,2);reasons.push("vẫn còn kịch bản gió mạnh")}
  else if(windProb>=0.10){level=Math.max(level,1)}
  if(rainProb>=0.50){level=Math.max(level,2);reasons.push("nhiều kịch bản cùng nghiêng về mưa")}
  else if(rainProb>=0.25){level=Math.max(level,1)}
  return {level,reasons};
}
function beaufort(kmh){
  const v=Math.max(0,num(kmh)||0);
  const limits=[1,6,12,20,29,39,50,62,75,89,103,118];
  const names=["Lặng gió","Rất nhẹ","Nhẹ","Gió yếu","Vừa","Khá mạnh","Mạnh","Gió lớn","Gió rất lớn","Bão","Bão mạnh","Bão rất mạnh","Cuồng phong"];
  let force=12;
  for(let i=0;i<limits.length;i++){if(v<limits[i]){force=i;break}}
  return {force,label:names[force]};
}
function probabilityLevel(v){
  v=num(v);
  if(v===null)return {label:"CHƯA RÕ",score:0};
  if(v>=0.60)return {label:"CAO",score:3};
  if(v>=0.30)return {label:"VỪA",score:2};
  if(v>=0.12)return {label:"THẤP - VỪA",score:1};
  return {label:"THẤP",score:0};
}
function variationLevel(w,r){
  const ws=num(w?.spread)||0,rs=num(r?.spread)||0;
  const raw=Math.max(ws/20,rs/10);
  const index=Math.round(clamp(raw*100,0,100));
  if(index>=70)return {label:"CAO",score:3,index};
  if(index>=40)return {label:"VỪA",score:2,index};
  if(index>=20)return {label:"NHẸ",score:1,index};
  return {label:"ỔN ĐỊNH",score:0,index};
}
function pct(v){
  v=num(v);return v===null?"-":Math.round(clamp(v,0,1)*100)+"%";
}
function rowVariability(r){
  const direct=num(r?.variability_score);
  if(direct!==null)return Math.round(clamp(direct,0,100));
  return variationLevel({spread:r?.wind_spread},{spread:r?.rain_spread}).index;
}
function rowConfidence(r){
  const direct=num(r?.confidence_score);
  if(direct!==null)return Math.round(clamp(direct,0,100));
  const completion=clamp(num(regionalForecast?.ensemble_completion_ratio)??0,0,1);
  const lead=Math.max(0,num(r?.lead_hours)||0);
  const leadPenalty=lead<=72?0:Math.min(35,35*(lead-72)/(240-72));
  const learning=String(regionalForecast?.calibration_status||"").toUpperCase()==="LEARNING"?8:0;
  return Math.round(clamp(100*completion-leadPenalty-learning,35,95));
}
function leadMoment(row){
  return row?.valid_time?localTime(row.valid_time):("+"+fmt(row?.lead_hours,0)+" giờ");
}
function rowValidMs(row){
  const t=Date.parse(row?.valid_time||"");
  return Number.isFinite(t)?t:null;
}
function isFutureForecastRow(row,graceMinutes=10){
  const t=rowValidMs(row);
  return t===null?true:t>=Date.now()-graceMinutes*60000;
}
function futureForecastRows(rows){
  return (Array.isArray(rows)?rows:[])
    .filter(r=>isFutureForecastRow(r))
    .sort((a,b)=>(rowValidMs(a)??Infinity)-(rowValidMs(b)??Infinity));
}
function setHazard(id,label,meta,level){
  const b=$(id),m=$(id+"Meta");if(!b||!m)return;
  b.textContent=label;m.textContent=meta;
  const card=b.closest("article");
  if(card)card.dataset.level=String(level||0);
}
function renderHazardBoard(){
  const points=islandIds().map(id=>({id,p:critical.points[id]}));

  // Mưa hiện tại: ưu tiên VRain đo thực, sau đó mới tới Local Now.
  const gauges=(critical?.actual?.rain_gauges||[])
    .filter(g=>freshEnough(g.observed_at,35))
    .map(g=>({...g,rate:num(g.rain_intensity_mm_h)}))
    .sort((a,b)=>(b.rate||0)-(a.rate||0));
  const fieldRain=combinedRecentFeedback().find(x=>feedbackCategoryFromRecord(x)==="RAIN_MORE");
  const recentGauge=gauges.filter(g=>num(g.recent_change_mm)>0&&num(g.recent_change_min)>0)
    .sort((a,b)=>(b.recent_change_mm||0)-(a.recent_change_mm||0))[0];
  const wetGauge=gauges.find(g=>g.rain_observed===true&&(g.rate||0)>0);
  if(fieldRain){
    const nm=fieldRain.point_name||pointDisplayName(fieldRain.point_id);
    setHazard(
      "hazardRain",
      nm+": thực địa báo mưa nhiều hơn ước tính",
      "VRain là số đo tại từng vị trí trạm, không đại diện toàn khu vực. Hệ thống đang giữ cảnh báo sai lệch này để đối chiếu.",
      3
    );
  }else if(wetGauge){
    const rate=wetGauge.rate||0;
    setHazard(
      "hazardRain",
      wetGauge.name+" đang mưa ~"+fmt(rate,1)+" mm/h",
      (num(wetGauge.increment_mm)!==null&&num(wetGauge.increment_min)!==null
        ?("VRain đo thực · +"+fmt(wetGauge.increment_mm,1)+" mm trong "+fmt(wetGauge.increment_min,0)+" phút")
        :"VRain đo thực · "+ageText(wetGauge.observed_at)),
      rate>=7.5?3:rate>=2.5?2:1
    );
  }else if(recentGauge){
    setHazard(
      "hazardRain",
      recentGauge.name+": vừa ghi nhận có mưa",
      "Tổng tại trạm tăng +"+fmt(recentGauge.recent_change_mm,1)+" mm trong khoảng "+fmt(recentGauge.recent_change_min,0)+" phút kể từ lần lấy trước. Chưa dùng khoảng này để tính mm/h hiện tại.",
      1
    );
  }else{
    const localRain=localDataFresh()?points.map(x=>({name:x.p.name,rate:num(x.p.local?.rain_rate_mm_h)||0,cls:x.p.local?.rain_class}))
      .sort((a,b)=>b.rate-a.rate)[0]:null;
    if(localRain&&localRain.rate>=0.5){
      setHazard("hazardRain",
        localRain.name+" ước tính ~"+fmt(localRain.rate,1)+" mm/h",
        "JoTrip Local Now · chưa phải số đo tại chỗ",
        localRain.rate>=7.5?3:localRain.rate>=2.5?2:1
      );
    }else{
      const dryNames=gauges.filter(g=>g.rain_observed===false).slice(0,3).map(g=>g.name);
      const cloudMax=points.map(x=>num(effectiveNowcastFor(x.id)?.convective_score)||0).sort((a,b)=>b-a)[0]||0;
      if(cloudMax>=70){
        setHazard("hazardRain",
          "Các trạm VRain gần đây chưa ghi nhận mưa tại đúng vị trí trạm",
          (dryNames.length?("VRain "+dryNames.join(", ")+" đang 0 mm/h. "):"")+
          "Tuy vậy Himawari đang thấy vùng mây rất cao quanh đảo, nên vẫn có thể có mưa cục bộ giữa các trạm.",
          1
        );
      }else{
        setHazard("hazardRain",
          "Chưa thấy mưa đáng kể trong các nguồn đang có",
          dryNames.length?("VRain "+dryNames.join(", ")+" hiện chưa ghi nhận mưa tại vị trí trạm"):"Ước tính mưa hiện tại đang thấp",
          0
        );
      }
    }
  }

  // Mây mưa 0-3 giờ: chỉ phát giờ đến khi backend xác nhận quỹ đạo cắt khu vực.
  const impacts=points.map(x=>{
    const n=effectiveNowcastFor(x.id),m=n.cloud_motion||{};
    return {id:x.id,name:x.p.name,n,m,eta:num(m.eta_minutes),score:num(n.convective_score)||0};
  });
  const incoming=impacts.filter(x=>x.m.public_track_usable&&x.m.predicted_impact&&x.eta!==null&&x.eta>=0&&x.eta<=180)
    .sort((a,b)=>a.eta-b.eta);
  if(incoming.length){
    const first=incoming[0];
    setHazard("hazardStorm",
      "Vùng mây mưa đang hướng tới "+first.name,
      motionEtaText(first.m)+" · "+cloudImpactText(first.id,first.n),
      first.eta<=60?3:2
    );
  }else{
    const strongest=impacts.sort((a,b)=>b.score-a.score)[0];
    if(strongest&&strongest.score>=70){
      const st=String(strongest.m.status||"").toUpperCase();
      const movement=st==="MOVING_AWAY"?"đang rời xa":st==="PASSING_BY"?"dự kiến đi lệch khu vực":"chưa xác định đường vào đủ rõ";
      const cloud=cloudStateLabel(strongest.n);
      setHazard("hazardStorm",
        cloud.label,
        strongest.name+" · "+movement+(cloud.detail?" · "+cloud.detail:""),
        1
      );
    }else{
      setHazard("hazardStorm","Chưa thấy vùng mây mưa đáng lo","Himawari chưa cho thấy quỹ đạo mây mạnh đi thẳng vào các điểm đảo trong 3 giờ tới",0);
    }
  }

  // Current local wind and time-stamped background marine wave are separate
  // sources. Do not silently substitute stale model wind for live local wind.
  const useLocal=localDataFresh();
  const windNow=useLocal?points.map(x=>({
    name:x.p.name,wind:x.p.local?.available?num(x.p.local.wind_kmh):null
  })).filter(x=>x.wind!==null).sort((a,b)=>b.wind-a.wind)[0]:null;
  const waveNow=points.map(x=>({
    name:x.p.name,hs:num(x.p.model?.wave_hs_m),
    sampled:x.p.model?.marine_sampled_time
  })).filter(x=>x.hs!==null&&freshEnough(x.sampled,210))
    .sort((a,b)=>b.hs-a.hs)[0];
  const windLabel=windNow?("Gió địa phương cao nhất "+windNow.name+" ~"+fmt(windNow.wind,0)+" km/h"):"Chưa có số gió tại điểm đủ mới";
  const windMeta=waveNow?("Sóng nền MÔ HÌNH ~"+fmt(waveNow.hs,1)+" m tại "+waveNow.name+" · "+phuQuocClock(waveNow.sampled)):"Chưa có số sóng nền mới";
  setHazard("hazardWind",windLabel,windMeta,windNow?.wind>=40||waveNow?.hs>=2?3:windNow?.wind>=30||waveNow?.hs>=1.5?2:0);

  // 12 giờ tới: dùng giá trị JoTrip forecast dễ đọc, không lấy probability làm dòng chính.
  const future=[];
  Object.values(regionalForecast?.regions||{}).forEach(region=>{
    (region.rows||[]).forEach(row=>{
      const ms=rowValidMs(row),hours=ms===null?num(row.lead_hours):(ms-Date.now())/3600000;
      if(hours===null||hours<0||hours>12)return;
      const rain=num(row.rain_mm)||0,wind=num(row.wind_kmh)||0,rainHigh=num(row.rain_q90_mm),windHigh=num(row.wind_q90_kmh);
      const severity=Math.max(
        rain>=7.5?3:rain>=2.5?2:rain>=.5?1:0,
        wind>=40?3:wind>=30?2:wind>=22?1:0,
        (rainHigh!==null&&rainHigh>=12)||(windHigh!==null&&windHigh>=40)?2:0
      );
      future.push({region:region.name||"Phú Quốc",row,hours,rain,wind,rainHigh,windHigh,severity});
    });
  });
  future.sort((a,b)=>b.severity-a.severity||a.hours-b.hours);
  const f=future[0];
  if(f&&f.severity>0){
    const time=f.row.valid_time?localTime(f.row.valid_time):("+"+fmt(f.hours,0)+" giờ");
    setHazard("hazardVolatility",
      f.region+" cần lưu ý khoảng "+time,
      "Mưa ~"+fmt(f.rain,1)+" mm/mốc · gió ~"+fmt(f.wind,0)+" km/h"+
        (f.rainHigh!==null?(" · kịch bản mưa cao "+fmt(f.rainHigh,1)+" mm"):"")+
        (f.windHigh!==null?(" · gió cao "+fmt(f.windHigh,0)+" km/h"):""),
      f.severity
    );
  }else{
    setHazard("hazardVolatility","Chưa thấy mốc xấu rõ trong 12 giờ tới","JoTrip vẫn tiếp tục đối chiếu ensemble và dữ liệu thực tế mỗi chu kỳ",0);
  }
}

function islandAssessment(){
  const rows=islandIds().map(id=>({id,p:critical.points[id],risk:pointRisk(critical.points[id],id)}));
  rows.sort((a,b)=>b.risk.level-a.risk.level);
  const worst=rows[0]?.risk.level||0;
  const label=worst>=3?"NÊN ĐIỀU CHỈNH":worst>=2?"THEO DÕI SÁT":worst>=1?"CÓ ĐIỂM CẦN LƯU Ý":"TƯƠNG ĐỐI ỔN";
  const attention=rows.filter(x=>x.risk.level>=2).slice(0,4);
  return {label,attention,rows};
}
function renderTechnicalPointTabs(){
  if(!critical)return;
  const nav=$("technicalPointTabs");
  // The primary point selector controls all sections, including deep analysis.
  if(nav)nav.innerHTML="";
  const title=$("technicalPointTitle");if(title)title.textContent=point().name||current;
}
function renderTechnicalFreshness(){
  const set=(id,iso,limit)=>{const el=$(id);if(!el)return;el.textContent=sourceAgeLabel(iso,limit);el.classList.toggle("stale",ageMinutes(iso)>limit)};
  set("technicalLocalAge",critical?.local_generated_at,35);
  set("technicalActualAge",actualTimestamp(),35);
  set("technicalNowcastAge",nowcastTimestamp(),35);
  set("technicalForecastAge",forecastTimestamp(),180);
}
function renderTechnicalPointForecast(){
  const body=$("technicalForecastRows"),title=$("technicalForecastTitle"),meta=$("technicalForecastMeta");
  if(!body)return;
  if(title)title.textContent="Chi tiết mô hình tại "+(point().name||current);
  const rows=(engineDashboard?.points?.[current]?.hours||[]).filter(r=>Date.parse(r.time_iso||"")>=Date.now()-30*60*1000);
  if(!rows.length){
    body.innerHTML='<tr><td colspan="6">Chưa có chuỗi dự báo theo điểm.</td></tr>';
    if(meta)meta.textContent="Đang chờ JoTrip Engine.";
    return;
  }
  body.innerHTML=rows.map(r=>'<tr>'+
    '<td><b>'+esc(localTime(r.time_iso))+'</b></td>'+
    '<td>'+ (num(r.temperature)===null?'-':fmt(r.temperature,1)+'°C') +'</td>'+
    '<td>'+ (num(r.wind)===null?'-':fmt(r.wind,1)+' km/h') +'</td>'+
    '<td>'+ (safeModelGust(r)===null?'-':fmt(r.gust,1)+' km/h') +'</td>'+
    '<td>'+ (num(r.rain)===null?'-':fmt(r.rain,2)+' mm/mốc') +'</td>'+
    '<td>'+ (num(r.wave)===null?'-':fmt(r.wave,2)+' m') +'</td>'+
  '</tr>').join("");
  if(meta)meta.textContent=rows.length+" mốc · JoTrip Engine · "+sourceAgeLabel(engineDashboard?.generated_at,180)+". D0-D3 có độ phân giải cao hơn; các ngày xa chỉ dùng như xu hướng.";
}
function renderTechnical(){
  renderTechnicalPointTabs();
  renderTechnicalFreshness();
  renderIntradayChart();
  renderTechnicalPointForecast();
  renderCurrent();
  renderHealth();
}

function renderPointTabs(){
  const nav=$("pointTabs");if(!nav||!critical)return;
  const ids=[...islandIds()];
  if(critical.points?.rach_gia&&!ids.includes("rach_gia"))ids.push("rach_gia");
  nav.innerHTML=ids.map(id=>{
    const comparison=id==="rach_gia";
    const label=esc(critical.points[id]?.name||id)+(comparison?" · đối chiếu":"");
    const title=comparison?' title="Điểm đối chiếu Rạch Giá - không tính vào tổng quan 7 điểm đảo"':"";
    return '<button class="'+(id===current?'active ':'')+(comparison?'off-island':'')+'" data-point="'+esc(id)+'"'+title+'>'+label+'</button>';
  }).join("")+
  '<button class="off-island" data-compare="ha_tien" title="Đối chiếu hành lang mây Himawari tại Hà Tiên">Hà Tiên · hành lang mây</button>';
}

function renderStatus(){
  if(!critical)return;
  const localAge=ageMinutes(critical?.local_generated_at);
  const actualAge=ageMinutes(actualTimestamp());
  const nowAge=ageMinutes(nowcastTimestamp());
  // The newest unrelated source must never make all sources look fresh.
  // For the customer-facing header, Local Now is the primary current-time source.
  const localDelayed=localAge===null||localAge>20;
  const localStale=localAge===null||localAge>35;
  const cloudDelayed=nowAge===null||nowAge>35;
  $("liveDot").className=localDelayed||cloudDelayed?"warn":"ok";
  const localLabel=critical?.local_generated_at?"Tại điểm "+ageText(critical.local_generated_at):"Tại điểm chưa có dữ liệu";
  const cloudLabel=nowcastTimestamp()?" · mây "+ageText(nowcastTimestamp()):" · mây chưa cập nhật";
  $("liveLabel").textContent=(localStale?"DỮ LIỆU TẠI ĐIỂM ĐANG TRỄ":localDelayed?"ĐANG CHỜ BẢN LÚC NÀY":"LÚC NÀY ĐÃ CẬP NHẬT")+" · "+localLabel+cloudLabel;

  const assessment=islandAssessment();
  const coverage=coverageScore();
  const confidence=confidenceScore();
  $("decisionNow").textContent=assessment.label;
  $("completenessNow").textContent=coverage+"% · "+islandIds().length+"/"+islandIds().length+" điểm";
  $("confidenceNow").textContent=confidence+"/100 · "+(confidence>=80?"cao":confidence>=60?"khá":"thận trọng");
  const fallbackLead=Math.max(0,...islandIds().flatMap(id=>(critical.points[id]?.ensemble?.rows||[]).map(r=>Number(r.lead_hours)||0)));
  const maxLead=Number(regionalForecast?.horizon_hours||fallbackLead||0);
  const regionalStale=regionalForecast?regionalForecastFreshness().stale:false;
  $("horizonNow").textContent=maxLead?(maxLead>=240?(regionalStale?"10 NGÀY · ĐANG CẬP NHẬT":"10 NGÀY"):maxLead+" giờ"):"CHƯA CÓ";
  $("completenessNow").parentElement.title="Tỷ lệ các lớp phân tích hiện tại, dự báo JoTrip, AQI, triều, Himawari và dự báo tổ hợp đang có dữ liệu trên 7 điểm đảo.";
  $("confidenceNow").parentElement.title="Mức tin cậy của toàn bộ dữ liệu đang dùng, không phải xác suất dự báo chắc chắn đúng.";
  const summary=$("islandSummary");
  if(summary){
    const watches=buildQuickWatchEvents().slice(0,2);
    if(watches.length){
      summary.innerHTML="<b>Hiện cần chú ý:</b> "+watches.map(x=>esc(x.title)+(x.detail?" - "+esc(x.detail):"")).join("<br>")+"<small>Tin nhanh tự biến mất khi dữ liệu mới cho thấy tình huống đã qua.</small>";
    }else{
      summary.innerHTML="<b>Toàn đảo:</b> hiện chưa thấy tình huống nào vượt ngưỡng theo dõi chính.<small>Hệ thống vẫn cập nhật mưa, gió, mây và biển theo từng chu kỳ.</small>";
    }
  }
  renderHazardBoard();
  $("dataMode").textContent=critical.data_mode==="B"?"ƯU TIÊN RỦI RO":(critical.data_mode||"-");
}

function summary(p){
  const l=p.local||{},m=p.model||{},bits=[];
  const localFresh=localDataFresh();
  const nowFresh=freshEnough(fullNowcast?.sampled_time||(p.nowcast||{}).sampled_time,35);
  const rain=localFresh?num(l.rain_rate_mm_h):null;
  const imminence=localFresh?num(l.rain_imminence_score):null;
  const conv=nowFresh?num(effectiveNowcast()?.convective_score??l.convection_score):null;
  const wind=localFresh&&l.available?num(l.wind_kmh):null;
  const wave=localFresh?num(l.wave_hs_m??m.wave_hs_m):num(m.wave_hs_m);
  if(rain!==null)bits.push(rain>=3?"Đang có mưa đáng chú ý":rain>.2?"Có mưa nhẹ hoặc rải rác":"Mưa hiện tại ít");
  if(imminence!==null&&imminence>=75)bits.push("mưa cục bộ có thể tăng nhanh trong 0-60 phút");
  else if(imminence!==null&&imminence>=55)bits.push("mưa ngắn hạn cần theo dõi");
  if(conv!==null&&conv>=70)bits.push("có mây dông đáng chú ý");
  if(wind!==null)bits.push("gió khoảng "+fmt(wind,0)+" km/h");
  if(wave!==null)bits.push("sóng khoảng "+fmt(wave,1)+" m");
  return bits.length?bits.join(" · ")+".":"Chưa đủ dữ liệu địa phương để tóm tắt.";
}

function kmBetween(lat1,lon1,lat2,lon2){
  if([lat1,lon1,lat2,lon2].some(v=>num(v)===null))return null;
  const r=6371.0088,toRad=x=>x*Math.PI/180;
  const p1=toRad(lat1),p2=toRad(lat2),dp=toRad(lat2-lat1),dl=toRad(lon2-lon1);
  const a=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return 2*r*Math.asin(Math.sqrt(a));
}
function nearestRainGauge(){
  const l=localPoint(),gauges=critical?.actual?.rain_gauges||[];
  const lat=num(l.reference_lat),lon=num(l.reference_lon);
  if(lat===null||lon===null||!gauges.length)return null;
  return gauges.map(g=>({...g,distance_km:kmBetween(lat,lon,g.lat,g.lon)}))
    .filter(g=>g.distance_km!==null)
    .sort((a,b)=>a.distance_km-b.distance_km)[0]||null;
}
function colocatedRainActual(maxDistanceKm=1.5,maxAgeMinutes=25){
  const g=nearestRainGauge();if(!g||num(g.distance_km)===null||g.distance_km>maxDistanceKm||g.qc!=="PASS")return null;
  const age=(Date.now()-Date.parse(g.observed_at||""))/60000;
  if(!Number.isFinite(age)||age<0||age>maxAgeMinutes)return null;
  let rate=null,state="";
  if(g.rain_observed===false||num(g.accum_mm)===0){rate=0;state="KHÔNG MƯA"}
  else if(num(g.rain_intensity_mm_h)!==null){rate=num(g.rain_intensity_mm_h);state=rate>0?"CÓ MƯA":"KHÔNG MƯA"}
  else if(num(g.increment_mm)!==null&&num(g.increment_min)>0){rate=num(g.increment_mm)*60/num(g.increment_min);state=rate>0?"CÓ MƯA":"KHÔNG MƯA"}
  if(rate===null)return null;
  return {...g,rate_mm_h:rate,state,age_minutes:age};
}
function rainActualContext(){
  const field=recentFeedbackFor(current,"RAIN_MORE");
  const g=nearestRainGauge();
  if(field){
    const where=point().name||current;
    const station=g?(" Trạm "+esc(g.name||"gần nhất")+" cách "+fmt(g.distance_km,1)+" km có thể ghi khác vì mưa cục bộ."):"";
    return "Phản hồi tại chỗ mới: "+esc(where)+" đang mưa nhiều hơn hệ thống ước tính."+station;
  }
  if(!g)return "";
  const name=esc(g.name||"gần nhất"),dist=fmt(g.distance_km,1);
  if(g.rain_observed===true){
    const rate=num(g.rain_intensity_mm_h);
    return "Trạm "+name+" đang ghi nhận mưa"+(rate!==null?" ~"+fmt(rate,1)+" mm/h":"")+" · cách điểm đang xem "+dist+" km.";
  }
  if(g.rain_observed===false||num(g.accum_mm)===0){
    return "Trạm "+name+" chưa ghi nhận mưa ngay tại vị trí trạm · cách "+dist+" km. Điều này không có nghĩa toàn khu vực đều khô.";
  }
  if(num(g.accum_mm)!==null){
    return "Trạm "+name+" đã ghi nhận tổng "+fmt(g.accum_mm,1)+" mm trong kỳ · cách "+dist+" km.";
  }
  return "Trạm mưa gần nhất: "+name+" · cách "+dist+" km.";
}
function weatherCondition(rain,conv,wind,forecast=false){
  rain=num(rain)||0;conv=num(conv)||0;wind=num(wind)||0;
  if(forecast){
    if(conv>=75&&rain>=1)return {label:"Có khả năng mưa dông cục bộ",icon:"⛈️",mood:"storm"};
    if(rain>=3)return {label:"Dự báo có mưa",icon:"🌧️",mood:"storm"};
    if(rain>=.2)return {label:"Có thể có mưa nhẹ hoặc rải rác",icon:"🌦️",mood:"watch"};
    if(conv>=60)return {label:"Mây đối lưu cần theo dõi",icon:"☁️",mood:"watch"};
    if(wind>=28)return {label:"Dự báo gió khá mạnh",icon:"💨",mood:"watch"};
    if(conv>=25)return {label:"Có thể nhiều mây",icon:"⛅",mood:"calm"};
    return {label:"Dự báo tương đối ổn",icon:"🌤️",mood:"calm"};
  }
  if(conv>=75&&rain>=1)return {label:"Mưa dông cục bộ",icon:"⛈️",mood:"storm"};
  if(rain>=3)return {label:"Đang có mưa",icon:"🌧️",mood:"storm"};
  if(rain>=.2)return {label:"Có mưa nhẹ hoặc rải rác",icon:"🌦️",mood:"watch"};
  if(conv>=60)return {label:"Mây đang phát triển",icon:"☁️",mood:"watch"};
  if(wind>=28)return {label:"Gió khá mạnh",icon:"💨",mood:"watch"};
  if(conv>=25)return {label:"Nhiều mây",icon:"⛅",mood:"calm"};
  return {label:"Thời tiết tương đối ổn",icon:"🌤️",mood:"calm"};
}
function nearbyVvpqActual(maxKm=12,maxMinutes=35){
  const p=point(),l=p.local||{},v=critical?.actual?.vvpq||{};
  if(!freshEnough(v.observed_at,maxMinutes))return null;
  const dist=kmBetween(l.reference_lat,l.reference_lon,v.lat,v.lon);
  if(dist===null||dist>maxKm)return null;
  const wx=String(v.weather||"").toUpperCase();
  return {
    ...v,
    distance_km:dist,
    thunder:/TS/.test(wx)||Boolean(v.convective_cloud),
    rain:/RA|SHRA|TS/.test(wx)
  };
}

function phuQuocIsNight(at=Date.now()){
  // The main hero is a live condition, not a daytime forecast icon.
  const hour=Number(new Intl.DateTimeFormat("en-GB",{
    timeZone:"Asia/Ho_Chi_Minh",hour:"2-digit",hourCycle:"h23"
  }).format(new Date(at)));
  return Number.isFinite(hour)&&(hour>=18||hour<6);
}
function heroIconForLocalTime(icon){
  if(!phuQuocIsNight())return icon;
  return {"🌤️":"🌙","⛅":"☁️","🌦️":"🌧️"}[icon]||icon;
}

function pointGustOutlook(id=current){
  return globalThis.JoTripGustOutlook?.pointOutlook({
    pointId:id,critical,nowcast:fullNowcast,dashboard:engineDashboard,
    groundtruth:currentBundle?.groundtruth||critical?._groundtruth||null,
    now:Date.now()
  })||null;
}
function renderPointGust(){
  const o=pointGustOutlook(),value=$("heroGust"),meta=$("heroGustMeta");
  const banner=$("gustShortOutlook"),head=$("gustShortTitle"),detail=$("gustShortDetail");
  if(!value||!meta||!banner||!head||!detail)return;
  // Only a physically colocated, verified METAR (or future sensor) is an
  // observed point gust. Model values always carry their forecast valid time.
  if(o?.observed){
    value.textContent=fmt(o.observed.gust_kmh,0);
    meta.textContent="km/h · ĐO THỰC "+phuQuocClock(o.observed.observed_at);
  }else if(o?.forecast){
    value.textContent=fmt(o.forecast.model_gust_kmh,0);
    meta.textContent="km/h · DỰ BÁO mốc "+phuQuocClock(o.forecast.valid_time)+
      " · không phải số đo lúc này";
  }else{
    value.textContent="--";
    meta.textContent="Chưa có số giật tại điểm đủ nguồn và thời gian";
  }
  const label=point().name||current;
  banner.className="gust-short-outlook "+
    (o?.status==="ALERT"?"alert":o?.status==="WATCH"?"watch":"unknown");
  const risk=o?.status==="ALERT"?"Cảnh giác cao":
    o?.status==="WATCH"?"Cần đề phòng":
    o?.status==="NO_VERIFIED_SIGNAL"?"Chưa thấy tín hiệu rõ":"Chưa đủ dữ liệu";
  head.textContent="Gió giật 0-30 phút · "+label+": "+risk;
  if(o?.status==="ALERT"||o?.status==="WATCH"){
    const lead=o.window?("Khung theo dõi "+o.window+". "):
      "Gió nền đáng chú ý nhưng chưa có ETA đáng tin cậy. ";
    const signs=o.evidence?.length?o.evidence.slice(0,3).join(" · ")+". ":"";
    detail.textContent=lead+signs+
      "Đây là tín hiệu rủi ro, không phải đo được gió giật hoặc xác suất đã kiểm chứng.";
  }else if(o?.status==="NO_VERIFIED_SIGNAL"){
    detail.textContent="Quan trắc và vệ tinh mới chưa cho tín hiệu đủ mạnh; không có nghĩa là sẽ không xuất hiện giật cục bộ.";
  }else{
    detail.textContent="Thiếu dữ liệu mới hoặc chưa theo dõi được hướng di chuyển của mây. Xem thông báo chính thức nếu chuẩn bị ra biển.";
  }
  if(o?.forecast&&!o.observed)
    detail.textContent+=" Mốc mô hình gần nhất: "+fmt(o.forecast.model_gust_kmh,0)+
      " km/h lúc "+phuQuocClock(o.forecast.valid_time)+".";
}

function renderHero(){
  const p=point(),l=p.local||{},m=modelPoint(),n=effectiveNowcast();
  $("placeName").textContent=p.name||current;
  const localFresh=localDataFresh();
  const nowcastRef=fullNowcast?.sampled_time||(p.nowcast||{}).sampled_time;
  const nowcastFresh=freshEnough(nowcastRef,75);
  const conv=nowcastFresh?num(n?.convective_score??l.convection_score):null;
  const t=localFresh?(num(l.temperature_c)??num(m.temperature_c)):num(m.temperature_c);
  // "Mưa tại điểm" must not show an old model rate as if it were current rain.
  const rain=localFresh&&l.available?num(l.rain_rate_mm_h):null;
  const wind=localFresh&&l.available?num(l.wind_kmh):null;
  const marineTimestamp=engineDashboard?.points?.[current]?.marine_sampled_time||m.marine_sampled_time||null;
  const marineFresh=marineTimestamp&&freshEnough(marineTimestamp,210);
  const wave=marineFresh?(num(m.wave_hs_m)??num(l.wave_hs_m)):null;

  const nearbyActual=nearbyVvpqActual();
  let condition;
  if(nearbyActual?.thunder&&nearbyActual?.rain){
    condition={label:"Đang có mưa dông gần khu vực",icon:"⛈️",mood:"storm"};
  }else if(nearbyActual?.rain){
    condition={label:"Đang có mưa gần khu vực",icon:"🌧️",mood:"storm"};
  }else if(!localFresh&&nowcastFresh&&conv!==null&&conv>=75){
    condition={label:"Mây đối lưu mạnh - có thể mưa dông cục bộ",icon:"⛈️",mood:"storm"};
  }else if(!localFresh&&nowcastFresh&&conv!==null&&conv>=50){
    condition={label:"Có mây đối lưu đáng chú ý",icon:"☁️",mood:"watch"};
  }else if(!localFresh&&!nowcastFresh){
    condition={label:"Chưa đủ dữ liệu mới để kết luận lúc này",icon:"⚠️",mood:"watch"};
  }else{
    condition=weatherCondition(rain,conv,wind,!localFresh);
  }

  $("heroTemp").textContent=t===null?"--":fmt(t,1)+"°";
  $("heroTempClass").textContent=localFresh&&l.available?"LÚC NÀY":"DỮ LIỆU GẦN NHẤT";
  $("heroCondition").textContent=condition.label;
  $("heroWeatherIcon").textContent=heroIconForLocalTime(condition.icon);
  $("heroRain").textContent=rain===null?"--":fmt(rain,1);
  $("heroWind").textContent=wind===null?"--":fmt(wind,0);
  $("heroWave").textContent=wave===null?"--":fmt(wave,1);
  renderPointGust();
  if($("heroRainMeta"))$("heroRainMeta").textContent=rain===null?"mm/h · chưa đủ số mới":"mm/h · JoTrip ước tính";
  if($("heroWindMeta"))$("heroWindMeta").textContent=wind===null?"km/h · chưa có số gió mới":"km/h · JoTrip ước tính";
  if($("heroWaveMeta"))$("heroWaveMeta").textContent=marineTimestamp
    ?("m Hs · sóng nền mô hình lúc "+phuQuocClock(marineTimestamp)+(marineFresh?"":" · đã trễ"))
    :"m Hs · chưa có mốc biển";
  let heroSummary=summary(p);
  if(nearbyActual?.thunder&&nearbyActual?.rain)heroSummary="Quan trắc VVPQ đang ghi nhận mưa dông cách điểm này khoảng "+fmt(nearbyActual.distance_km,1)+" km. Ưu tiên tình trạng đang xảy ra hơn dự báo mô hình.";
  else if(nearbyActual?.rain)heroSummary="Quan trắc VVPQ đang ghi nhận mưa cách điểm này khoảng "+fmt(nearbyActual.distance_km,1)+" km.";
  else if(!localFresh&&!nowcastFresh)heroSummary="Dữ liệu tại điểm và ảnh mây đều đang trễ - không nên dùng số cũ để kết luận trời đang ổn.";
  else if(!localFresh&&nowcastFresh&&conv!==null&&conv>=50)heroSummary="Tín hiệu vệ tinh đang đáng chú ý. Số mưa tại điểm chưa có cập nhật mới - xem bản đồ nếu chuẩn bị ra ngoài.";
  $("heroSummary").textContent=heroSummary;
  $("updatedAt").textContent=(localFresh?"Cập nhật ":"Dữ liệu tại điểm gần nhất ")+localTime(liveTimestamp())+" · "+ageText(liveTimestamp());
  $("updatedAt").classList.toggle("stale",!localFresh);
  if($("scenePoint"))$("scenePoint").textContent=p.name||current;
  if($("sceneTemp"))$("sceneTemp").textContent=t===null?"--":fmt(t,1)+"°";
  if($("sceneUpdated"))$("sceneUpdated").textContent=(localFresh?"JoTrip Local Now":"JoTrip gần nhất")+" · "+ageText(liveTimestamp());
  document.querySelector(".weather-overview")?.setAttribute("data-mood",condition.mood);
}

function phuQuocDateKey(iso){
  const d=new Date(iso);
  if(!Number.isFinite(d.getTime()))return "";
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Ho_Chi_Minh",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(d);
  const get=t=>parts.find(x=>x.type===t)?.value||"";
  return get("year")+"-"+get("month")+"-"+get("day");
}
function phuQuocClock(iso){
  const d=new Date(iso);
  return Number.isFinite(d.getTime())?d.toLocaleTimeString("vi-VN",{timeZone:"Asia/Ho_Chi_Minh",hour:"2-digit",minute:"2-digit",hour12:false}):"-";
}
function todayLiveOverride(){
  const p=point(),l=p.local||{},n=effectiveNowcast();
  const actual=nearbyVvpqActual();
  if(actual?.thunder&&actual?.rain)return {cls:"avoid",label:"Nên né khung này",reason:"Quan trắc gần khu vực đang ghi nhận mưa dông"};
  if(actual?.rain)return {cls:"watch",label:"Cần để ý",reason:"Quan trắc gần khu vực đang ghi nhận mưa"};
  const localFresh=localDataFresh();
  const nowcastFresh=freshEnough(fullNowcast?.sampled_time||(p.nowcast||{}).sampled_time,35);
  const imminence=localFresh?num(l.rain_imminence_score):null;
  const conv=nowcastFresh?num(n?.convective_score??l.convection_score):null;
  if((imminence!==null&&imminence>=80)||(conv!==null&&conv>=85))return {cls:"avoid",label:"Nên né khung này",reason:"Tín hiệu đối lưu ngắn hạn đang mạnh"};
  if((imminence!==null&&imminence>=60)||(conv!==null&&conv>=65))return {cls:"watch",label:"Cần để ý",reason:"Có tín hiệu mưa/đối lưu ngắn hạn"};
  if(!localFresh&&!nowcastFresh)return {cls:"watch",label:"Cần để ý",reason:"Dữ liệu live đang trễ - kiểm tra bản đồ"};
  return null;
}
function safeModelGust(row){
  return globalThis.JoTripWindGuard?.validForecastFrame(row)?num(row.gust):null;
}
function todayUiState(row,index=0){
  if(index===0&&Math.abs(Date.parse(row?.time_iso||"")-Date.now())<=60*60*1000){
    const live=todayLiveOverride();
    if(live)return live;
  }
  // Future slots keep JoTrip Engine land-tour gates; this is not a new forecast model.
  const rain=num(row?.rain),gust=safeModelGust(row);
  if((rain!==null&&rain>=50)||(gust!==null&&gust>=62))return {cls:"avoid",label:"Nên né khung này"};
  if((rain!==null&&rain>=20)||(gust!==null&&gust>=50))return {cls:"watch",label:"Cần để ý"};
  return {cls:"good",label:"Khá thuận lợi"};
}
function todayWeatherIcon(row){
  const rain=num(row?.rain)||0,gust=safeModelGust(row)||0;
  const d=new Date(row?.time_iso||"");
  const hour=Number.isFinite(d.getTime())?Number(d.toLocaleString("en-US",{timeZone:"Asia/Ho_Chi_Minh",hour:"numeric",hour12:false})):12;
  if(rain>=20||gust>=50)return "⛈️";
  if(rain>=3)return "🌧️";
  if(rain>=.5)return hour>=18||hour<6?"☁️":"🌦️";
  if(hour>=18||hour<6)return "🌙";
  return "🌤️";
}
function engineTodayRows(){
  const rows=engineDashboard?.points?.[current]?.hours||[];
  if(!Array.isArray(rows)||!rows.length)return [];
  const now=Date.now(),today=phuQuocDateKey(new Date(now).toISOString());
  return rows.filter(r=>{
    const t=Date.parse(r?.time_iso||"");
    return Number.isFinite(t)&&t>=now&&phuQuocDateKey(r.time_iso)===today;
  }).slice(0,5);
}
function renderTodayDecision(){
  const root=$("todayDecisionStrip"),summaryEl=$("todayDecisionSummary"),meta=$("todayEngineMeta"),badge=$("todayEngineBadge");
  if(!root||!summaryEl)return;
  if(!engineDashboard){
    root.innerHTML='<span class="inline-loader">Đang lấy dữ liệu từ JoTrip Engine...</span>';
    summaryEl.textContent="Đang đọc các mốc thời tiết còn lại hôm nay.";
    return;
  }
  if(!globalThis.JoTripWindGuard?.dashboardUsable(engineDashboard)){
    root.innerHTML='<div class="today-decision-empty"><b>Dự báo theo giờ đang trễ hoặc chu kỳ mô hình đã cũ</b><span>Không dùng số cũ để kết luận biển an toàn. Theo dõi quan trắc và thông báo chính thức.</span></div>';
    summaryEl.textContent="Chưa có dự báo mới đủ điều kiện công bố các mốc còn lại hôm nay.";
    return;
  }
  const rows=engineTodayRows();
  const enginePoint=engineDashboard.points?.[current]||{};
  if(badge)badge.textContent=(enginePoint.name||point().name||"Phú Quốc")+" · JoTrip Engine";
  const cycle=engineDashboard.source_cycles?.ECMWF;
  if(meta)meta.textContent="JoTrip Engine · ECMWF · mốc thật 3 giờ"+(cycle?" · chu kỳ "+localTime(cycle):"");
  const marineLabel=$("todayMarineReference");
  if(marineLabel){
    const mt=enginePoint.marine_sampled_time;
    const hs=num(enginePoint.wave);
    const old=ageMinutes(mt);
    const offshore=rows.find(r=>r.wave_reference?.status==="PASS")?.wave_reference;
    const marineBase=hs!==null&&mt
      ?(" Sóng nền Copernicus: "+fmt(hs,2)+" m Hs lúc "+phuQuocClock(mt)+(old!==null&&old>210?" (bản đã trễ).":"."))
      :" Sóng nền Copernicus chưa có số mới.";
    marineLabel.textContent=offshore
      ?("Sóng từng mốc giờ: dự báo ECMWF tại ô biển ngoài khơi phía "+(offshore.coast_side==="WEST"?"Tây":"Đông")+", cách điểm tham chiếu "+fmt(offshore.distance_km,1)+" km. Không phải số đo sát bờ."+marineBase)
      :rows.some(r=>num(r.wave)!==null)
        ?("Sóng từng mốc giờ: dự báo ECMWF Wave tại ô biển theo cấu hình của điểm."+marineBase)
        :"Chưa có dự báo sóng cho đúng các mốc giờ. Không lấy sóng nền hiện tại lấp vào giờ thiếu."+marineBase;
  }
  if(!rows.length){
    root.innerHTML='<div class="today-decision-empty"><b>Không còn mốc 3 giờ nào trong hôm nay</b><span>Xem 10 ngày bên dưới cho ngày mai và các ngày tiếp theo.</span></div>';
    summaryEl.textContent="Hôm nay đã gần hết. JoTrip không nội suy thêm giờ giả để lấp khoảng trống.";
    return;
  }
  const rank={good:0,watch:1,avoid:2};
  let worst=null,goodCount=0;
  root.innerHTML=rows.map((r,index)=>{
    const state=todayUiState(r,index),icon=todayWeatherIcon(r);
    if(state.cls==="good")goodCount++;
    if(!worst||rank[state.cls]>rank[worst.state.cls])worst={row:r,state};
    const rain=num(r.rain),wind=num(r.wind),gust=safeModelGust(r),wave=num(r.wave),temp=num(r.temperature);
    return '<article class="today-decision-card '+state.cls+'">'+
      '<time>'+esc(phuQuocClock(r.time_iso))+'</time>'+
      '<div class="today-weather-icon" aria-hidden="true">'+icon+'</div>'+
      '<strong>'+(temp===null?'-':fmt(temp,0)+'°')+'</strong>'+
      '<b>'+state.label+'</b>'+
      (state.reason?'<small class="today-reason">'+esc(state.reason)+'</small>':'')+
      '<div class="today-mini">'+
        '<span>Mưa '+(rain===null?'-':fmt(rain,1)+' mm/3h')+'</span>'+
        '<span>Gió '+(wind===null?'-':fmt(wind,0)+' km/h')+'</span>'+
        '<span>Giật '+(gust===null?'-':fmt(gust,0)+' km/h')+'</span>'+
        '<span>Sóng '+(wave===null?'chưa có theo giờ':fmt(wave,2)+' m')+'</span>'+
      '</div>'+
    '</article>';
  }).join("");
  if(worst?.state.cls==="avoid"){
    summaryEl.textContent="Có mốc nên né khoảng "+phuQuocClock(worst.row.time_iso)+". Nếu lịch linh hoạt, ưu tiên các ô xanh.";
  }else if(worst?.state.cls==="watch"){
    summaryEl.textContent=(goodCount?"Vẫn còn "+goodCount+" mốc khá thuận lợi. ":"")+"Có thời điểm cần để ý thêm mưa hoặc gió giật.";
  }else{
    summaryEl.textContent="Các mốc còn lại hôm nay hiện đều nằm trong ngưỡng khá thuận lợi của JoTrip Engine.";
  }
}
async function loadEngineDashboard(){
  try{
    engineDashboard=await getJSON(ENGINE_DASHBOARD,5*60*1000);
    refreshSnapshotAuthority();
    renderStatus();
    renderHero();
    renderTodayDecision();
    renderJoTripForecast();
    renderForecastDayDetail();
    renderQuickAlert();
    if($("deepWeatherDetails")?.open){renderTechnicalPointForecast();renderTechnicalFreshness()}
  }catch(e){
    console.warn("[Weather V2] JoTrip Engine today",e);
    const root=$("todayDecisionStrip"),summaryEl=$("todayDecisionSummary");
    if(root)root.innerHTML='<div class="today-decision-empty"><b>Chưa tải được các mốc hôm nay</b><span>Phần Lúc này, 10 ngày và Radar vẫn hoạt động bình thường.</span></div>';
    if(summaryEl)summaryEl.textContent="JoTrip Engine đang cập nhật lại dữ liệu theo giờ.";
  }
}

function renderCurrent(){
  const l=localPoint(),m=modelPoint(),n=effectiveNowcast();
  const localFresh=localDataFresh();
  setMetric("windNow",localFresh&&l.available?l.wind_kmh:null,1);
  setBadge("windClass",localFresh&&l.available?(l.wind_class||"ESTIMATED_NOW"):"UNAVAILABLE",localFresh&&l.available?null:"CHƯA CÓ SỐ MỚI");
  const rainMeta=$("rainMeta"),rainCtx=$("rainActualContext");
  const rainNowValue=localFresh&&l.available?num(l.rain_rate_mm_h):(num(m.rain_3h_mm)===null?null:num(m.rain_3h_mm)/3);
  setMetric("rainNow",rainNowValue,2);
  const rainConf=localFresh?num(l.rain_confidence):null;
  setBadge("rainClass",localFresh&&l.available?(l.rain_class||"ESTIMATED_NOW"):"MODEL_ONLY",localFresh?null:"MÔ HÌNH");
  const rainImm=num(l.rain_imminence_score),rainImmLevel=String(l.rain_imminence_level||"").toUpperCase();
  if(rainMeta)rainMeta.innerHTML=localFresh&&l.available
    ?'mm/h · <span id="rainConfidence">'+(rainConf===null?"-":Math.round(rainConf*100))+'</span>% tin cậy'
    :'mm/h · quy đổi từ mưa mô hình 3h · số đo tại điểm '+ageText(liveTimestamp());
  if(rainCtx){
    const actualCtx=rainActualContext();
    const nowCtx=rainImm!==null&&rainImm>=55?nowcastPlainText(n,rainImm):"";
    rainCtx.innerHTML=[actualCtx,nowCtx].filter(Boolean).map(x=>'<span class="ctx-line">'+x+'</span>').join("");
  }
  const cloudNow=cloudStateLabel(n);
  if($("convectiveNow"))$("convectiveNow").textContent=cloudNow.label==="Chưa đủ dữ liệu mây"?"-":
    (num(n.convective_score)>=75?"MÂY RẤT CAO":num(n.convective_score)>=50?"ĐANG PHÁT TRIỂN":num(n.convective_score)>=25?"CÓ MÂY ĐÁNG CHÚ Ý":"ÍT TÍN HIỆU");
  if($("convectiveMeta"))$("convectiveMeta").textContent=cloudNow.detail||"Himawari · chưa đủ chi tiết";
  setMetric("waveNow",localFresh?(l.wave_hs_m??m.wave_hs_m):m.wave_hs_m,2);
  setBadge("marineClass",localFresh?(l.marine_class||"MODEL_ONLY"):"MODEL_ONLY",localFresh?null:"MÔ HÌNH");
  setMetric("hmaxNow",m.wave_hmax_m,2);
  setMetric("periodNow",m.period_s,1);
  setMetric("currentNow",m.current_kmh,2);
}

function renderActual(){
  const a=critical.actual||{},v=a.vvpq||{},g=a.rain_gauges||[],cards=[];
  if(current==="rach_gia"){
    cards.push('<article class="actual-card"><header><b>Rạch Giá</b><em class="badge model">MÔ HÌNH</em></header><strong>Chưa có số đo trực tiếp đang hoạt động</strong><small>Hiện chỉ dùng mô hình cùng Himawari, AQI và triều ở những nguồn đang có dữ liệu. Không lấy VVPQ/VRain Phú Quốc để đại diện cho Rạch Giá.</small></article>');
    $("actualStrip").innerHTML=cards.join("");
    $("actualState").textContent="Chưa có nguồn đo trực tiếp đang hoạt động";
    return;
  }
  const verifiedGust=globalThis.JoTripGustOutlook?.metarGust(
    currentBundle?.groundtruth||critical?._groundtruth||null,Date.now());
  const airportGust=verifiedGust?" · giật "+fmt(verifiedGust.gust_kmh,0)+" km/h (METAR)":
    (freshEnough(v.observed_at,35)?" · METAR không có số giật được công bố":"");
  cards.push('<article class="actual-card"><header><b>VVPQ</b><em class="badge actual">ĐO THỰC</em></header><strong>'+fmt(v.temperature_c,1)+'°C</strong><small>Gió '+fmt(v.wind_kmh,1)+' km/h'+airportGust+' · '+(v.weather?esc(v.weather)+' · ':'')+ageText(v.observed_at)+'</small></article>');
  g.forEach(x=>{
    const win=num(x.increment_min),inc=num(x.increment_mm),rate=num(x.rain_intensity_mm_h),acc=num(x.accum_mm);
    let observed="CHƯA CÓ DỮ LIỆU HIỆN TẠI";
    let detail="Không đủ dữ liệu mới để xác định trạng thái mưa.";

    if(x.rain_observed===true){
      observed="CÓ MƯA";
      detail="Lượng mưa "+fmt(inc,2)+" mm / "+fmt(win,0)+" phút";
      if(rate!==null)detail+=" · cường độ "+fmt(rate,2)+" mm/h";
    }else if(x.rain_observed===false){
      observed="TRẠM CHƯA GHI NHẬN MƯA";
      detail="Tại đúng vị trí trạm chưa ghi nhận thêm lượng mưa trong "+fmt(win,0)+" phút gần nhất. Không dùng kết quả này để kết luận cả khu vực đều không mưa."
    }else if(acc===0){
      observed="TRẠM CHƯA GHI NHẬN MƯA";
      detail="VRain tại đúng vị trí trạm hiện ghi 0 mm trong kỳ quan trắc. Mưa cục bộ có thể xảy ra ngoài vị trí trạm."
    }else if(num(x.recent_change_mm)>0&&num(x.recent_change_min)>0){
      observed="VỪA GHI NHẬN CÓ MƯA";
      detail="Trạm tăng thêm "+fmt(x.recent_change_mm,1)+" mm trong khoảng "+fmt(x.recent_change_min,0)+" phút kể từ lần lấy dữ liệu trước. Khoảng lấy mẫu quá dài nên không dùng để tính cường độ mưa hiện tại.";
    }else if(acc!==null&&acc>0){
      observed="ĐÃ CÓ MƯA TRONG KỲ";
      detail="Tổng kỳ "+fmt(acc,1)+" mm · chưa đủ hai mẫu gần nhau để kết luận đang mưa ngay lúc này.";
    }

    if(acc!==null&&x.rain_observed!==true&&!(acc>0&&x.rain_observed===null))detail+=" · tổng kỳ "+fmt(acc,1)+" mm";
    detail+=" · "+ageText(x.observed_at);
    cards.push('<article class="actual-card rain-actual"><header><b>'+esc(x.name)+'</b><em class="badge actual">ĐO THỰC</em></header><strong>'+observed+'</strong><small>'+detail+'</small></article>');
  });
  $("actualStrip").innerHTML=cards.join("");
  const vFresh=freshEnough(v.observed_at,45);
  const rainFresh=g.some(x=>freshEnough(x.observed_at,45));
  $("actualState").textContent=(vFresh&&rainFresh)?"VVPQ + VRain vừa cập nhật":"Có nguồn cập nhật chậm";
}

function renderFeedbackPoint(){
  const label=$("feedbackPointLabel");if(!label)return;
  label.textContent="Theo "+(point().name||current);
}

function aqiLabel(cat){
  const map={GOOD:"Tốt",MODERATE:"Trung bình",UNHEALTHY_FOR_SENSITIVE_GROUPS:"Không tốt cho nhóm nhạy cảm",UNHEALTHY:"Không tốt",VERY_UNHEALTHY:"Rất không tốt",HAZARDOUS:"Nguy hại"};
  return map[cat]||cat||"Chưa xác định";
}
function effectiveAQI(){
  const compact=point().aqi||{};
  if(!fullAQI)return compact;
  const p=fullAQI.points?.[current]||{};
  return {
    status:fullAQI.status,
    sampled_time:p.sampled_time||fullAQI.sampled_time,
    aqi_us:p.aqi_us,
    category:p.category,
    aqi_source:p.aqi_source,
    source_city:p.source_city||p.iqair_city,
    pm25_ugm3:p.pm25_ugm3,
    pm10_ugm3:p.pm10_ugm3,
    model_aqi_us:p.model_aqi_us,
    divergence:p.source_divergence_aqi
  };
}
function renderAQI(){
  const a=effectiveAQI();
  if(num(a.aqi_us)===null&&num(a.pm25_ugm3)===null&&num(a.pm10_ugm3)===null){
    $("aqiQuick").innerHTML='<div class="data-empty"><b>ĐANG CHỜ DỮ LIỆU AQI</b><span>Điểm này chưa có số AQI trong bản dữ liệu hiện tại.</span></div>';
    setBadge("aqiSourceBadge","UNAVAILABLE","CHƯA CÓ");
    $("aqiAge").textContent="Không nội suy AQI từ điểm khác để lấp số.";
    return;
  }
  $("aqiQuick").innerHTML=
    '<div class="quick-item"><span>US AQI</span><b>'+fmt(a.aqi_us,0)+'</b><small>'+esc(aqiLabel(a.category))+'</small></div>'+
    '<div class="quick-item"><span>PM2.5</span><b>'+fmt(a.pm25_ugm3,1)+'</b><small>µg/m³ · CAMS tham chiếu</small></div>'+
    '<div class="quick-item"><span>PM10</span><b>'+fmt(a.pm10_ugm3,1)+'</b><small>µg/m³ · CAMS tham chiếu</small></div>'+
    '<div class="quick-item"><span>AQI CAMS</span><b>'+fmt(a.model_aqi_us,0)+'</b><small>mô hình tham chiếu</small></div>'+
    '<div class="quick-item"><span>Chênh lệch AQI</span><b>'+fmt(a.divergence,0)+'</b><small>IQAir - CAMS</small></div>'+
    '<div class="quick-item"><span>Điểm tham chiếu</span><b class="small-value">'+esc(a.source_city||"-")+'</b><small>'+esc(a.aqi_source||"-")+'</small></div>';
  setBadge("aqiSourceBadge",a.aqi_source==="IQAIR_COMMUNITY_REALTIME"?"ACTUAL":"MODEL_ONLY",a.aqi_source==="IQAIR_COMMUNITY_REALTIME"?"IQAIR TRỰC TIẾP":"CAMS");
  $("aqiAge").textContent="AQI cập nhật "+ageText(a.sampled_time)+". 0-50: tốt · 51-100: trung bình · trên 100: bắt đầu đáng lưu ý. Khi chưa có phép đo PM2.5/PM10 phù hợp, hệ thống dùng CAMS làm nguồn tham chiếu.";
}

function effectiveTide(){
  const compact=point().tide||{};
  if(!fullTide)return compact;
  const p=fullTide.points?.[current]||{};
  return {
    status:p.status||fullTide.status,
    generated_at:fullTide.generated_at,
    height_m:p.current_height_m,
    current_time:p.current_time,
    trend:p.trend,
    range_24h_m:p.range_24h_m,
    next_high:p.next_high?{type:p.next_high.type,time:p.next_high.time_iso,height_m:p.next_high.height_m}:null,
    next_low:p.next_low?{type:p.next_low.type,time:p.next_low.time_iso,height_m:p.next_low.height_m}:null,
    next_turn:p.next_turn?{type:p.next_turn.type,time:p.next_turn.time_iso,height_m:p.next_turn.height_m}:null,
    source:fullTide.source,
    series:p.series||[]
  };
}
function tideTrend(v){return v==="RISING"?"Đang lên":v==="FALLING"?"Đang xuống":v==="TURNING"?"Đang đổi nước":"-"}
function renderTide(){
  const t=effectiveTide();
  if(num(t.height_m)===null&&!t.next_high&&!t.next_low){
    $("tideQuick").innerHTML='<div class="data-empty"><b>ĐANG CHỜ DỮ LIỆU TRIỀU</b><span>Chưa có dữ liệu triều phù hợp cho khu vực này trong lần cập nhật hiện tại.</span></div>';
    $("tideAge").textContent="Triều luôn giữ nhãn MÔ HÌNH, không thay bằng số từ điểm khác.";
    drawTide([]);
    return;
  }
  $("tideQuick").innerHTML=
    '<div class="quick-item"><span>Mực triều</span><b>'+fmt(t.height_m,2)+' m</b><small>'+esc(tideTrend(t.trend))+'</small></div>'+
    '<div class="quick-item"><span>Triều cao kế</span><b>'+localTime(t.next_high?.time)+'</b><small>'+fmt(t.next_high?.height_m,2)+' m</small></div>'+
    '<div class="quick-item"><span>Triều thấp kế</span><b>'+localTime(t.next_low?.time)+'</b><small>'+fmt(t.next_low?.height_m,2)+' m</small></div>'+
    '<div class="quick-item"><span>Đổi nước</span><b>'+localTime(t.next_turn?.time)+'</b><small>'+esc(t.next_turn?.type||"-")+'</small></div>'+
    '<div class="quick-item"><span>Biên độ 24h</span><b>'+fmt(t.range_24h_m,2)+' m</b><small>cao nhất - thấp nhất</small></div>'+
    '<div class="quick-item"><span>Nguồn</span><b class="small-value">'+esc(t.source||"FES2014")+'</b><small>không phải trạm triều</small></div>';
  $("tideAge").textContent="Triều mô hình cập nhật "+ageText(t.generated_at||t.current_time)+". Không dùng thay mực nước hải đồ cảng.";
  drawTide(t.series||[]);
}
function drawTide(series){
  const svg=$("tideSpark");if(!svg)return;
  if(!series||series.length<2){svg.innerHTML='<text x="300" y="65" text-anchor="middle" fill="#8b9ba5" font-size="10">Chuỗi triều 24h đang tải nền...</text>';return}
  const now=Date.now(),rows=series.filter(r=>{const tt=Date.parse(r.time_iso);return Number.isFinite(tt)&&tt>=now-3600000&&tt<=now+24*3600000});
  const vals=rows.map(r=>num(r.height_m)).filter(v=>v!==null);
  if(vals.length<2){svg.innerHTML='<text x="300" y="65" text-anchor="middle" fill="#8b9ba5" font-size="10">Không đủ chuỗi triều</text>';return}
  const min=Math.min(...vals),max=Math.max(...vals),span=Math.max(.05,max-min);
  const pts=rows.map((r,i)=>{const x=15+i*(570/Math.max(1,rows.length-1)),y=105-(num(r.height_m)-min)/span*85;return x.toFixed(1)+","+y.toFixed(1)}).join(" ");
  svg.innerHTML='<line x1="15" y1="105" x2="585" y2="105" class="tide-base-v2"/><polyline points="'+pts+'" class="tide-line-v2"/>';
}

function effectiveNowcastFor(id){
  const c=critical?.points?.[id]?.nowcast||{};
  if(!fullNowcast)return c;
  const p=fullNowcast.points?.[id]||{},sig=p.convective_signal||{};
  return {
    status:fullNowcast.status,
    sampled_time:fullNowcast.sampled_time,
    source:fullNowcast.source,
    cloud_top_cold_c:p.cold_cloud_top_temp_c??p.regional_cold_cloud_top_temp_c??c.cloud_top_cold_c,
    cloud_top_high_m:p.high_cloud_top_height_m??p.regional_high_cloud_top_height_m??c.cloud_top_high_m,
    cooling_c_per_20m:p.cooling_c_per_20m_proxy??c.cooling_c_per_20m,
    convective_score:p.score??sig.score??c.convective_score,
    convective_level:p.level??sig.level??c.convective_level,
    cloud_motion:p.cloud_motion??c.cloud_motion??null,
    lightning:p.lightning_observed||fullNowcast.lightning_observed?.status||c.lightning
  };
}
function effectiveNowcast(){return effectiveNowcastFor(current)}
function cloudStateLabel(n){
  const score=num(n?.convective_score),top=num(n?.cloud_top_high_m),temp=num(n?.cloud_top_cold_c),cool=num(n?.cooling_c_per_20m);
  if(score===null)return {label:"Chưa đủ dữ liệu mây",detail:""};
  let label="",detail="";
  if(score>=75&&top!==null&&top>=12000){
    if(cool!==null&&cool<=-3){
      label="Cụm mây rất cao, đang phát triển nhanh";
      detail="Đỉnh mây lạnh đi rõ trong 20 phút";
    }else if(cool!==null&&cool<=-1){
      label="Cụm mây rất cao, đang phát triển";
      detail="Đỉnh mây tiếp tục lạnh đi";
    }else if(cool!==null&&cool>=1.5){
      label="Cụm mây rất cao, có xu hướng yếu dần";
      detail="Đỉnh mây đang ấm lên";
    }else{
      label="Cụm mây rất cao";
      detail="Ít thay đổi trong 20 phút gần đây";
    }
  }else if(score>=50){
    label="Mây cao đáng chú ý";
    detail=cool!==null&&cool<=-1?"Đỉnh mây đang lạnh đi":"Theo dõi thêm trên ảnh vệ tinh";
  }else if(score>=25){
    label="Có cụm mây đáng chú ý";
    detail="Tín hiệu vệ tinh ở mức cần theo dõi";
  }else{
    label="Chưa thấy cụm mây dông rõ";
    detail="Tín hiệu vệ tinh hiện thấp";
  }
  const tech=[];
  if(top!==null)tech.push("đỉnh ~"+fmt(top/1000,1)+" km");
  if(temp!==null)tech.push(fmt(temp,0)+"°C");
  if(tech.length)detail+=(detail?" · ":"")+tech.join(" · ");
  return {label,detail};
}
function motionConfidenceLabel(v){
  return ({MEDIUM_HIGH:"Khá rõ",MEDIUM:"Tạm rõ",LOW:"Chưa chắc"}[String(v||"").toUpperCase()]||"Chưa đủ dữ liệu");
}
function motionSourceText(m){
  if(!m)return "Chưa track được";
  const sector=m.source_sector?"Phía "+m.source_sector:"";
  const near=m.nearest_corridor?.name?("gần hướng "+m.nearest_corridor.name):"";
  return [sector,near].filter(Boolean).join(" · ")||"Chưa rõ";
}
function motionHeadingText(m){
  if(!m)return "Chưa đủ dữ liệu";
  if(!m.motion_heading)return "Hướng chưa ổn định";
  const speed=num(m.motion_speed_kmh);
  return "Về "+m.motion_heading+(speed!==null?" · "+fmt(speed,0)+" km/h":" · tốc độ chưa chắc");
}
function motionEtaText(m){
  if(!m)return "Chưa đủ dữ liệu";
  const st=String(m.status||"").toUpperCase(),eta=num(m.eta_minutes);
  if(st==="NEARBY"||eta===0)return "Đang ảnh hưởng khu vực";
  if(m.predicted_impact&&m.arrival_time){
    const start=localTime(m.arrival_time).split(" ").pop();
    const end=m.exit_time?localTime(m.exit_time).split(" ").pop():null;
    return end&&end!==start?("Khoảng "+start+"-"+end):("Khoảng "+start);
  }
  if(m.predicted_impact&&eta!==null){
    const d=new Date(Date.now()+eta*60000);
    return "Khoảng "+d.toLocaleTimeString("vi-VN",{timeZone:"Asia/Ho_Chi_Minh",hour:"2-digit",minute:"2-digit",hour12:false});
  }
  if(st==="PASSING_BY")return "Dự kiến đi lệch khu vực";
  if(st==="MOVING_AWAY")return "Đang rời xa";
  if(st==="BEYOND_HORIZON")return "Chưa dự kiến ảnh hưởng trong 3 giờ";
  if(st==="TRACK_UNCERTAIN")return "Chưa đủ dữ liệu để tính";
  if(st==="TRACKED")return "Chưa dự kiến ảnh hưởng trong 3 giờ";
  if(st==="NO_TRACKABLE_CONVECTIVE_CLOUD")return "Chưa có cụm mây rõ";
  return "Chưa đủ dữ liệu để tính";
}
function cloudImpactText(id,n){
  const p=critical?.points?.[id]||{},l=p.local||{},m=p.model||{},motion=n?.cloud_motion||{};
  if(!(motion.predicted_impact||String(motion.status||"").toUpperCase()==="NEARBY")){
    const st=String(motion.status||"").toUpperCase();
    if(st==="PASSING_BY")return "Không dự kiến mưa do cụm này";
    if(st==="TRACK_UNCERTAIN")return "Chờ xác nhận đường đi";
    if(st==="BEYOND_HORIZON")return "Chưa đánh giá ngoài 3 giờ";
    if(st==="MOVING_AWAY")return "Không dự kiến tác động trực tiếp";
    return "Chưa dự kiến tác động trực tiếp";
  }
  if(l.rain_impact_label)return l.rain_impact_label;
  const avg=Math.max(0,(num(m.rain_3h_mm)||0)/3),score=num(n?.convective_score)||0;
  let label=avg>=7.5?"Mưa mạnh":avg>=2.5?"Mưa vừa":avg>=.5?"Mưa nhẹ đến vừa":avg>.05?"Mưa nhẹ":"Nền model ít mưa";
  if(score>=75&&avg<2.5)label+=", cục bộ có thể mạnh hơn";
  else if(score>=75)label+=", cục bộ có thể mưa mạnh";
  return label;
}
function nowcastPlainText(n,rainImm){
  const m=n?.cloud_motion||{};
  if(String(m.status||"").toUpperCase()==="APPROACHING"&&num(m.eta_minutes)!==null){
    return "Cụm mây đối lưu ở "+motionSourceText(m).toLowerCase()+", đang "+motionHeadingText(m).toLowerCase()+", có thể tới khu vực sau "+motionEtaText(m)+".";
  }
  if(String(m.status||"").toUpperCase()==="NEARBY"){
    return "Cụm mây đối lưu đang ở gần khu vực.";
  }
  if(num(rainImm)!==null&&rainImm>=75)return "Mây đối lưu đang mạnh, mưa cục bộ có thể tăng trong 0-60 phút.";
  if(num(n?.convective_score)!==null&&num(n.convective_score)>=70)return "Mây đối lưu đang hoạt động mạnh quanh khu vực.";
  return "";
}
function renderCloudMotionTable(){
  const body=$("cloudMotionRows"),age=$("cloudMotionAge");if(!body)return;
  const ids=[...islandIds()];
  const rows=ids.map(id=>{
    const p=critical.points[id]||{},n=effectiveNowcastFor(id),m=n.cloud_motion||{};
    return {
      name:p.name||id,
      nowcast:n,
      score:num(n.convective_score),
      motion:m,
      sampled:n.sampled_time
    };
  });
  const corridor=fullNowcast?.corridor_motion?.ha_tien;
  if(corridor){
    rows.push({name:"Hà Tiên - đối chiếu",nowcast:{convective_score:num(corridor.max_convective_score),cloud_motion:corridor},score:num(corridor.max_convective_score),motion:corridor,sampled:fullNowcast.sampled_time,corridor:true});
  }
  if(!rows.length){
    body.innerHTML='<tr><td colspan="6">Chưa có dữ liệu chuyển động mây.</td></tr>';
    return;
  }
  const nowcastRef=fullNowcast?.sampled_time||rows[0]?.sampled;
  const nowcastFresh=freshEnough(nowcastRef,75);
  body.innerHTML=rows.map(r=>{
    const m=r.motion||{},cloud=cloudStateLabel(r.nowcast||{convective_score:r.score});
    const id=Object.keys(critical?.points||{}).find(k=>(critical.points[k]?.name||k)===r.name)||null;
    const eta=nowcastFresh?motionEtaText(m):"Chờ ảnh mới";
    const heading=nowcastFresh
      ?(m.public_track_usable===false?"Chưa đủ dữ liệu đường đi":motionHeadingText(m))
      :"Dữ liệu vệ tinh đang trễ";
    const impact=nowcastFresh?(id?cloudImpactText(id,r.nowcast):"Theo dõi hành lang mây"):"Không phát ETA từ ảnh cũ";
    return '<tr>'+
      '<td><b>'+esc(r.name)+'</b></td>'+
      '<td><b>'+esc(cloud.label)+'</b><small>'+esc(cloud.detail)+'</small></td>'+
      '<td>'+esc(motionSourceText(m))+'</td>'+
      '<td>'+esc(heading)+'</td>'+
      '<td><b>'+esc(eta)+'</b></td>'+
      '<td>'+esc(impact)+'</td>'+
    '</tr>';
  }).join("");
  if(age)age.textContent="Himawari · "+ageText(nowcastRef)+(nowcastFresh?"":" · dữ liệu đang trễ");
}
function renderMapConvective(){
  const n=effectiveNowcast();
  const score=$("mapConvectiveScore"),cloud=$("mapCloudTop"),height=$("mapCloudHeight");
  const cool=$("mapCooling"),meaning=$("mapCoolingMeaning"),fresh=$("mapCloudFreshness");
  const state=cloudStateLabel(n),temp=num(n.cloud_top_cold_c),top=num(n.cloud_top_high_m),delta=num(n.cooling_c_per_20m);
  if(score)score.textContent=state.label;
  if(cloud)cloud.textContent=temp===null?"-":fmt(temp,1)+"°C";
  if(height)height.textContent=top===null?"":("Khoảng "+fmt(top/1000,1)+" km");
  if(cool&&meaning){
    if(delta===null){
      cool.textContent="-";
      meaning.textContent="Chưa đủ hai ảnh liên tiếp để tính xu hướng";
    }else if(delta<=-3){
      cool.textContent="Lạnh thêm "+fmt(Math.abs(delta),1)+"°C";
      meaning.textContent="Đỉnh mây đang phát triển nhanh";
    }else if(delta<=-1){
      cool.textContent="Lạnh thêm "+fmt(Math.abs(delta),1)+"°C";
      meaning.textContent="Đỉnh mây đang phát triển";
    }else if(delta>=2){
      cool.textContent="Ấm lên "+fmt(delta,1)+"°C";
      meaning.textContent="Đỉnh mây có xu hướng yếu dần";
    }else{
      cool.textContent="Ít thay đổi";
      if(Math.abs(delta)<.5){
        meaning.textContent="Đỉnh mây gần như ổn định trong 20 phút";
      }else if(delta<0){
        meaning.textContent="Đỉnh mây lạnh nhẹ "+fmt(Math.abs(delta),1)+"°C trong 20 phút";
      }else{
        meaning.textContent="Đỉnh mây ấm nhẹ "+fmt(delta,1)+"°C trong 20 phút";
      }
    }
  }
  if(fresh){
    const ref=n?.sampled_time||fullNowcast?.sampled_time;
    fresh.textContent=(ref?"Himawari · "+ageText(ref)+" · ":"")+"Quan trắc đỉnh mây, không phải xác suất mưa hay sét.";
  }
}

function ensembleData(){
  return point().ensemble||{};
}
function forecastBand(prob){
  prob=num(prob);
  if(prob===null)return "chưa đủ dữ liệu";
  if(prob>=0.50)return "cao";
  if(prob>=0.25)return "vừa";
  if(prob>=0.10)return "thấp đến vừa";
  return "thấp";
}
function forecastCardState(windProb,rainProb){
  windProb=num(windProb)||0;rainProb=num(rainProb)||0;
  if(windProb>=0.25||rainProb>=0.50)return {label:"CẦN THEO DÕI",cls:"watch"};
  if(windProb>=0.10||rainProb>=0.25)return {label:"CÓ DAO ĐỘNG",cls:"variable"};
  return {label:"KHÁ ỔN ĐỊNH",cls:"stable"};
}
function regionRows(){
  return regionalForecast?.regions?.[currentRegion]?.rows||[];
}
function regionMeta(){
  return regionalForecast?.regions?.[currentRegion]||null;
}
const REGION_PUBLIC_NAMES={
  north_northwest:"Gành Dầu - Cửa Cạn",
  central_west:"Dương Đông",
  east_northeast:"Bãi Thơm - Hàm Ninh",
  south_southeast:"Bãi Sao - An Thới"
};
function regionPublicName(id,region){
  return REGION_PUBLIC_NAMES[id]||region?.name||id.replaceAll("_"," ");
}
function regionalForecastFreshness(){
  if(!regionalForecast)return {stale:true,ageMin:Infinity,runAgeMin:Infinity,text:"chưa có dữ liệu"};
  const builtAge=ageMinutes(regionalForecast.generated_at);
  const runAge=ageMinutes(regionalForecast.run_time);
  const ageMin=Number.isFinite(builtAge)?builtAge:Infinity;
  const runAgeMin=Number.isFinite(runAge)?runAge:Infinity;
  const stale=ageMin>12*60||runAgeMin>18*60;
  const ref=regionalForecast.generated_at||regionalForecast.run_time;
  return {
    stale,ageMin,runAgeMin,
    text:ref?(stale?"Dữ liệu dự báo đang trễ · tổng hợp "+localTime(ref):"Cập nhật "+ageText(ref)):"không rõ thời gian"
  };
}
function renderForecastRegionTabs(){
  const nav=$("forecastRegionTabs");if(!nav)return;
  const regions=regionalForecast?.regions||{};
  nav.innerHTML=Object.entries(regions).map(([id,r])=>
    '<button class="'+(id===currentRegion?'active':'')+'" data-region="'+esc(id)+'">'+esc(regionPublicName(id,r))+'</button>'
  ).join("")||'<span class="inline-loader">Đang chờ dữ liệu vùng...</span>';
}
function phuQuocDay(iso){
  const d=new Date(iso);
  if(!Number.isFinite(d.getTime()))return null;
  const parts=new Intl.DateTimeFormat("vi-VN",{timeZone:"Asia/Ho_Chi_Minh",year:"numeric",month:"2-digit",day:"2-digit",weekday:"short"}).formatToParts(d);
  const get=t=>parts.find(x=>x.type===t)?.value||"";
  return {key:get("year")+"-"+get("month")+"-"+get("day"),label:get("weekday"),date:get("day")+"/"+get("month")};
}
function worstConfidence(values){
  const rank={"THẬN TRỌNG":3,"TRUNG BÌNH":2,"KHÁ":1};
  return values.sort((a,b)=>(rank[b]||0)-(rank[a]||0))[0]||"-";
}
function dailyWeatherSummary(rainMax,rainProb,windMax,hasNowcastImpact){
  rainMax=num(rainMax);rainProb=num(rainProb)||0;windMax=num(windMax)||0;
  if(hasNowcastImpact)return {icon:"⛈️",label:"Mưa dông cần theo dõi",cls:"watch"};
  if(rainMax!==null&&rainMax>=5)return {icon:"🌧️",label:"Có lúc mưa nhiều",cls:"watch"};
  if(rainProb>=.50)return {icon:"🌦️",label:"Dễ có mưa rào",cls:"watch"};
  if(windMax>=30)return {icon:"💨",label:"Gió khá mạnh",cls:"variable"};
  if(rainProb>=.25)return {icon:"⛅",label:"Có thể có mưa",cls:"variable"};
  return {icon:"🌤️",label:"Khá ổn",cls:"stable"};
}
function renderForecastDayRibbon(rows){
  const root=$("forecastDayRibbon");if(!root)return;
  const groups=new Map();
  rows.forEach(r=>{
    const day=phuQuocDay(r.valid_time);if(!day)return;
    if(!groups.has(day.key))groups.set(day.key,{day,rows:[]});
    groups.get(day.key).rows.push(r);
  });
  const todayKey=phuQuocDateKey(new Date().toISOString());
  const days=[...groups.values()].filter(x=>x.day.key>todayKey).slice(0,10);
  root.innerHTML=days.map(({day,rows},index)=>{
    const temps=rows.map(r=>num(r.temperature_c)).filter(v=>v!==null);
    const winds=rows.map(r=>num(r.wind_kmh)).filter(v=>v!==null);
    const rains=rows.map(r=>num(r.rain_mm)).filter(v=>v!==null);
    const rainProb=Math.max(0,...rows.map(r=>num(r.rain_prob_5)).filter(v=>v!==null));
    const hasNowcastImpact=rows.some(r=>
      r.nowcast_overlay?.operational_impact===true &&
      ["HIGH","ELEVATED"].includes(String(r.nowcast_overlay?.level||"").toUpperCase())
    );
    const windMax=winds.length?Math.max(...winds):null;
    const rainMax=rains.length?Math.max(...rains):null;
    const state=dailyWeatherSummary(rainMax,rainProb,windMax,hasNowcastImpact);
    let tempText="-";
    if(temps.length){
      const lo=Math.round(Math.min(...temps)),hi=Math.round(Math.max(...temps));
      tempText=lo===hi?lo+"°":lo+"° - "+hi+"°";
    }
    const meta=[
      rainMax===null?null:"Mưa ~"+fmt(rainMax,1)+" mm",
      windMax===null?null:"Gió "+fmt(windMax,0)+" km/h"
    ].filter(Boolean).join(" · ");
    const dayLabel=index===0?"Ngày mai":day.label;
    const selected=selectedForecastDayKey===day.key;
    return '<article class="forecast-day '+state.cls+(selected?' selected':'')+'" role="button" tabindex="0" data-forecast-day="'+esc(day.key)+'" aria-expanded="'+(selected?'true':'false')+'">'+
      '<header><b>'+esc(day.date)+'</b><span>'+esc(dayLabel)+'</span></header>'+
      '<div class="forecast-day-icon" aria-hidden="true">'+state.icon+'</div>'+
      '<strong>'+tempText+'</strong>'+
      '<h4>'+esc(state.label)+'</h4>'+
      '<small>'+esc(meta||"Đang cập nhật")+'</small>'+
      '<em class="forecast-day-open">'+(selected?'Đang mở':'Xem theo giờ')+'</em>'+
    '</article>';
  }).join("")||'<span class="inline-loader">Chưa đủ dữ liệu để tóm tắt 10 ngày.</span>';
}

function watchSeverityRank(v){return ({alert:3,watch:2,info:1}[v]||0)}
function freshEnough(iso,maxMin){return ageMinutes(iso)<=maxMin}
function pointDisplayName(id){return critical?.points?.[id]?.name||id.replaceAll("_"," ")}
function buildQuickWatchEvents(){
  const events=[];
  const now=Date.now();

  // Independent freshness warning. An old successful payload is NOT live.
  const localAge=ageMinutes(liveTimestamp()),cloudAge=ageMinutes(nowcastTimestamp());
  if(localAge>35||cloudAge>45){
    const stale=[];
    if(localAge>35)stale.push("số liệu tại điểm "+ageText(liveTimestamp()));
    if(cloudAge>45)stale.push("ảnh mây "+ageText(nowcastTimestamp()));
    events.push({
      key:"weather-data-delayed",
      severity:"alert",when:"DỮ LIỆU ĐANG TRỄ",
      title:"Chưa có cập nhật đủ mới để kết luận thời tiết đã ổn",
      detail:stale.join(" · ")+". Không xem dữ liệu cũ là điều kiện hiện tại; ưu tiên cảnh báo chính thức và thông tin thực địa.",
      sort:-9
    });
  }

  // Observed cumulative rainfall is a screening signal for possible low-
  // lying-area flooding, NEVER a claim that a particular road is flooded.
  // Do not convert a multi-hour accumulation into hourly rain intensity.
  const heavyGauges=(critical?.actual?.rain_gauges||[])
    .filter(g=>num(g.accum_mm)!==null&&num(g.accum_mm)>=80&&freshEnough(g.observed_at,360))
    .sort((a,b)=>b.accum_mm-a.accum_mm);
  if(heavyGauges.length){
    const main=heavyGauges[0],veryHeavy=heavyGauges.filter(g=>g.accum_mm>=100);
    const seen=heavyGauges.slice(0,3).map(g=>g.name+" "+fmt(g.accum_mm,0)+" mm");
    const starts=heavyGauges.map(g=>g.period_start).filter(Boolean);
    const sharedStart=starts.length===heavyGauges.length&&new Set(starts).size===1?starts[0]:null;
    const when=sharedStart?"từ "+localTime(sharedStart):"trong kỳ quan trắc";
    events.push({
      key:"heavy-cumulative-rain:"+main.observed_at,
      severity:veryHeavy.length?"alert":"watch",
      when:"MƯA TÍCH LŨY · SỐ ĐO GẦN NHẤT",
      title:"Mưa tích lũy lớn, đề phòng ngập ở những nơi thấp",
      detail:seen.join(" · ")+" ("+when+", cập nhật "+localTime(main.observed_at)+"). Đây không phải lượng mưa một giờ và chưa xác nhận vị trí đường nào đang ngập.",
      sort:-4
    });
  }

  // 0) Recent field reports are operational context only, never numeric ground truth.
  const field=combinedRecentFeedback();
  field.slice(0,8).forEach(x=>{
    const cat=feedbackCategoryFromRecord(x),name=x.point_name||pointDisplayName(x.point_id);
    if(cat==="RAIN_MORE"){
      events.push({
        key:"field-rain:"+x.id,severity:"alert",when:"PHẢN HỒI TẠI CHỖ",
        title:name+": mưa đang nhiều hơn hệ thống ước tính",
        detail:"Quan sát thực địa mới. Hệ thống giữ riêng phản hồi này và không tự biến nó thành số mm/h.",
        sort:-2
      });
    }else if(cat==="WIND_MORE"){
      events.push({
        key:"field-wind:"+x.id,severity:"watch",when:"PHẢN HỒI TẠI CHỖ",
        title:name+": gió đang mạnh hơn hệ thống ước tính",
        detail:"Quan sát thực địa mới. Dùng để cảnh báo sai lệch và đối chiếu lại với nguồn đo/mô hình.",
        sort:-1
      });
    }else if(cat==="THUNDER"){
      events.push({
        key:"field-thunder:"+x.id,severity:"watch",when:"PHẢN HỒI TẠI CHỖ",
        title:name+": có dông được báo tại hiện trường",
        detail:"Quan sát thực địa mới, đang đối chiếu với Himawari và các nguồn khác.",
        sort:-1
      });
    }
  });

  // 0b) Fresh airport observation is ACTUAL and can override model language nearby.
  const vvpq=critical?.actual?.vvpq||{};
  const vwx=String(vvpq.weather||"").toUpperCase();
  if(freshEnough(vvpq.observed_at,35)&&(/TS/.test(vwx)||vvpq.convective_cloud)){
    events.push({
      key:"vvpq-thunderstorm:"+vvpq.observed_at,
      severity:"alert",
      when:"ĐANG XẢY RA",
      title:"Khu vực gần sân bay Phú Quốc đang có mưa dông",
      detail:"Quan trắc VVPQ ghi nhận mưa dông và mây đối lưu. Đây là số liệu thực tế, được ưu tiên hơn dự báo mô hình tại thời điểm này.",
      sort:-1.5
    });
  }else if(freshEnough(vvpq.observed_at,35)&&/RA|SHRA/.test(vwx)){
    events.push({
      key:"vvpq-rain:"+vvpq.observed_at,
      severity:"watch",
      when:"ĐANG XẢY RA",
      title:"Khu vực gần sân bay Phú Quốc đang có mưa",
      detail:"Quan trắc VVPQ đang ghi nhận mưa thực tế.",
      sort:-1.2
    });
  }

  // 1) Direct rain observations: only fresh gauges with measurable current rain.
  (critical?.actual?.rain_gauges||[]).forEach(g=>{
    const rate=num(g.rain_intensity_mm_h),inc=num(g.increment_mm),win=num(g.increment_min);
    if(g.rain_observed!==true||rate===null||rate<2.5||!freshEnough(g.observed_at,30))return;
    const sev=rate>=7.5?"alert":"watch";
    events.push({
      key:"vrain:"+g.name,
      severity:sev,
      when:"ĐANG XẢY RA",
      title:g.name+": "+(rate>=7.5?"đang mưa mạnh":"đang mưa vừa"),
      detail:(inc!==null&&win!==null
        ?("VRain ghi nhận +"+fmt(inc,1)+" mm trong khoảng "+fmt(win,0)+" phút, tương đương ~"+fmt(rate,1)+" mm/h.")
        :("VRain đang ghi nhận ~"+fmt(rate,1)+" mm/h.")),
      sort:0
    });
  });

  // Universal point forecasts and genuinely short-range convective wind
  // indicators. The engine makes no 5-minute gust-speed estimate from 3h NWP.
  const aggregate=globalThis.JoTripGustOutlook?.islandAlerts({
    critical,nowcast:fullNowcast,dashboard:engineDashboard,
    groundtruth:currentBundle?.groundtruth||critical?._groundtruth||null,now
  });
  for(const alert of (aggregate?.alerts||[])){
    const short=alert.type==="GUST_0_30",times=(alert.valid_times||[])
      .filter(t=>t!=="0-30_MIN_CONDITIONAL").map(t=>phuQuocClock(t));
    events.push({
      key:alert.alert_id,
      severity:alert.severity,
      when:short?"GIÓ GIẬT NGẮN HẠN":"DỰ BÁO MỐC "+times.join(" · "),
      title:alert.point_name+": "+(short?"cần đề phòng gió giật":"dự báo gió mạnh tại những mốc tới"),
      detail:short?(alert.evidence.join(" · ")+". Đây là tín hiệu rủi ro 0-30 phút, KHÔNG phải số đo giật."):
        ("Gió giật mô hình cao nhất "+fmt(alert.forecast_gust_kmh,0)+" km/h tại các mốc "+
          times.join(", ")+". Không suy diễn mạnh liên tục giữa hai mốc."),
      sort:short?-7:-4
    });
  }
  if(aggregate&&!aggregate.model_valid){
    events.push({
      key:"wind-model-unavailable",
      severity:"watch",when:"CHU KỲ MÔ HÌNH",
      title:"Chưa có dữ liệu mới đủ tin cậy cho cảnh báo gió theo giờ",
      detail:"Không coi thiếu cảnh báo là điều kiện biển an toàn. Đối chiếu quan trắc và VISHIPEL.",
      sort:-3
    });
  }

  // 1b) Wave risk at individual points. Model Hs is forecast, never a
  // measurement of breaking waves at a beach or a vessel departure ban.
  if(globalThis.JoTripWindGuard?.dashboardUsable(engineDashboard,now)){
    islandIds().forEach(id=>{
      const pt=engineDashboard?.points?.[id],name=pointDisplayName(id);
      const rows=(pt?.hours||[]).filter(r=>{
        const t=Date.parse(r.time_iso||"");
        return Number.isFinite(t)&&t>=now&&t<=now+6*3600000&&
          globalThis.JoTripWindGuard.validForecastFrame(r)&&
          num(r.wave)!==null&&r.wave>=1.5;
      }).sort((a,b)=>Date.parse(a.time_iso)-Date.parse(b.time_iso));
      if(!rows.length)return;
      const peak=Math.max(...rows.map(r=>r.wave));
      events.push({
        key:"wave-model:"+id+":"+rows.map(r=>r.time_iso).join("|"),
        severity:peak>=2.0?"alert":"watch",
        when:"SÓNG DỰ BÁO · "+rows.map(r=>phuQuocClock(r.time_iso)).join(" · "),
        title:name+": mô hình dự báo sóng đáng chú ý",
        detail:"Hs cao nhất "+fmt(peak,2)+" m tại các mốc "+
          rows.map(r=>phuQuocClock(r.time_iso)).join(", ")+
          ". Đây là sóng có nghĩa tại điểm mô hình, không phải sóng đo sát bờ hay quyết định cấm tàu.",
        sort:-2
      });
    });
  }

  // 2) Current strong wind: group places instead of repeating one event per point.
  const windHits=islandIds().map(id=>{
    const p=critical?.points?.[id]||{},l=p.local||{};
    return {id,name:p.name||id,wind:num(l.wind_kmh)};
  }).filter(x=>x.wind!==null&&x.wind>=30);
  if(windHits.length&&freshEnough(liveTimestamp(),30)){
    const names=windHits.slice(0,4).map(x=>x.name);
    const maxWind=Math.max(...windHits.map(x=>x.wind||0));
    events.push({
      key:"wind:island",
      severity:maxWind>=40?"alert":"watch",
      when:"HIỆN TẠI",
      title:"Gió đang mạnh tại "+names.join(", ")+(windHits.length>4?" và một số khu vực khác":""),
      detail:"Gió địa phương ước tính cao nhất khoảng "+fmt(maxWind,0)+" km/h. Chưa có số gió giật hiện tại đủ tin cậy.",
      sort:1
    });
  }

  // 2b) Island-wide convective rain signal - plain language, no fake certainty.
  const islandWet=islandIds().map(id=>{
    const p=critical?.points?.[id]||{},n=effectiveNowcastFor(id);
    return {
      id,name:p.name||id,
      rain:num(p.local?.rain_rate_mm_h)||0,
      conv:num(n?.convective_score??p.local?.convection_score)||0
    };
  });
  const convContextFresh=
    freshEnough(liveTimestamp(),30)&&
    freshEnough(fullNowcast?.sampled_time||effectiveNowcast()?.sampled_time,75);
  const convWet=islandWet.filter(x=>x.conv>=70&&x.rain>=.5);
  if(convContextFresh&&convWet.length>=4){
    const rates=convWet.map(x=>x.rain),lo=Math.min(...rates),hi=Math.max(...rates);
    events.push({
      key:"island-convective-rain",
      severity:"watch",
      when:"HIỆN TẠI",
      title:"Nhiều khu vực trên đảo đang có mây rất cao kèm tín hiệu mưa",
      detail:"JoTrip Local Now tại các điểm đang ở khoảng "+fmt(lo,1)+"-"+fmt(hi,1)+" mm/h. Mưa dông cục bộ giữa các điểm có thể mạnh hơn giá trị trung bình này.",
      sort:1.5
    });
  }

  // 3) Satellite cloud paths: publish only tracks that pass the backend safety gate.
  const impacts=[];
  islandIds().forEach(id=>{
    const n=effectiveNowcastFor(id),m=n.cloud_motion||{};
    const eta=num(m.eta_minutes);
    if(!freshEnough(n.sampled_time||fullNowcast?.sampled_time,40))return;
    if(!m.public_track_usable||!m.predicted_impact||eta===null||eta<=0||eta>180)return;
    impacts.push({id,name:pointDisplayName(id),n,m,eta});
  });
  const groups=new Map();
  impacts.forEach(x=>{
    const arrival=Date.parse(x.m.arrival_time||"");
    const bucket=Number.isFinite(arrival)?Math.round(arrival/(30*60000)):Math.round(x.eta/30);
    const key=(x.m.source_sector||"?")+"|"+(x.m.motion_heading||"?")+"|"+bucket;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(x);
  });
  groups.forEach(items=>{
    items.sort((a,b)=>a.eta-b.eta);
    const first=items[0],names=items.map(x=>x.name);
    const arrival=first.m.arrival_time?localTime(first.m.arrival_time).split(" ").pop():("~"+Math.round(first.eta)+" phút nữa");
    const impactLabels=[...new Set(items.map(x=>cloudImpactText(x.id,x.n)).filter(Boolean))];
    events.push({
      key:"cloud:"+names.join("|")+":"+arrival,
      severity:first.eta<=60?"alert":"watch",
      when:"DỰ KIẾN "+arrival,
      title:"Vùng mây mưa đang hướng tới "+names.join(", "),
      detail:"Himawari cho thấy đường đi đang cắt qua khu vực. "+(impactLabels[0]||"Cường độ đang được đối chiếu với model và ensemble")+".",
      sort:Math.max(2,first.eta/60)
    });
  });

  // 4) One near-term ensemble watch, only from a fresh regional product.
  // Stale D0-D10 data remains visible for context but must not generate a live alert.
  const forecast=[];
  const regionalFresh=!regionalForecastFreshness().stale;
  if(regionalFresh) Object.entries(regionalForecast?.regions||{}).forEach(([regionId,region])=>{
    (region.rows||[]).forEach(row=>{
      const validMs=rowValidMs(row);
      const hours=validMs===null?num(row.lead_hours):(validMs-now)/3600000;
      if(hours===null||hours<0||hours>12)return;
      const rain=num(row.rain_prob_5)||0,wind=num(row.wind_prob_30)||0,varScore=rowVariability(row)/100;
      if(rain<.50&&wind<.25&&varScore<.70)return;
      forecast.push({region:regionPublicName(regionId,region),row,hours,rain,wind,varScore});
    });
  });
  forecast.sort((a,b)=>a.hours-b.hours);
  if(forecast.length){
    const x=forecast[0],bits=[];
    if(x.rain>=.50)bits.push("mưa có tín hiệu tăng");
    if(x.wind>=.25)bits.push("gió có tín hiệu tăng");
    if(x.varScore>=.70)bits.push("các kịch bản đang phân tán mạnh");
    events.push({
      key:"forecast:"+x.region+":"+leadMoment(x.row),
      severity:"watch",
      when:leadMoment(x.row),
      title:x.region+": có diễn biến cần theo dõi trong 12 giờ tới",
      detail:bits.join(" · ")+".",
      sort:5+x.hours
    });
  }

  // Preserve the complete list for audit. The UI initially shows six and
  // exposes the remaining active notices on demand rather than hiding them.
  return events.sort((a,b)=>(watchSeverityRank(b.severity)-watchSeverityRank(a.severity))||(a.sort-b.sort)).slice(0,30);
}
function renderQuickAlert(){
  const root=$("quickAlert"),list=$("quickAlertList"),count=$("quickWatchCount");
  if(!root||!list)return;
  const events=buildQuickWatchEvents();
  root.hidden=events.length===0;
  if(count)count.textContent=String(events.length);
  if(!events.length){list.innerHTML="";return}
  const makeItem=e=>
    '<article class="quick-watch-item '+esc(e.severity)+'">'+
      '<div class="quick-watch-dot"></div>'+
      '<div><small>'+esc(e.when)+'</small><b>'+esc(e.title)+'</b><p>'+esc(e.detail)+'</p></div>'+
    '</article>';
  const first=events.slice(0,6).map(makeItem).join("");
  const rest=events.slice(6);
  // Preserve the open state across automatic refreshes every minute.
  const wasOpen=Boolean($("quickWatchMore")?.open);
  list.innerHTML=first+(rest.length?
    '<details id="quickWatchMore" class="quick-watch-more" '+(wasOpen?'open':'')+'>'+
      '<summary>Xem thêm '+rest.length+' cảnh báo và quan trắc</summary>'+
      '<div class="quick-watch-list">'+rest.map(makeItem).join("")+'</div>'+
    '</details>':'');
}

function engineRowsForDay(dayKey){
  const rows=engineDashboard?.points?.[current]?.hours||[];
  return rows.filter(r=>phuQuocDateKey(r.time_iso)===dayKey);
}
function engineDayStepHours(rows){
  if(rows.length<2)return null;
  const gaps=rows.slice(1).map((r,i)=>(Date.parse(r.time_iso)-Date.parse(rows[i].time_iso))/3600000).filter(x=>Number.isFinite(x)&&x>0);
  return gaps.length?Math.min(...gaps):null;
}
function renderForecastDayDetail(){
  const box=$("forecastDayDetail"),slots=$("forecastDayDetailSlots"),title=$("forecastDayDetailTitle"),note=$("forecastDayDetailNote");
  if(selectedForecastDayKey&&selectedForecastDayKey<=phuQuocDateKey(new Date().toISOString()))selectedForecastDayKey=null;
  if(!box||!slots)return;
  if(!selectedForecastDayKey){box.hidden=true;return}
  box.hidden=false;
  const dayRows=engineRowsForDay(selectedForecastDayKey);
  const p=engineDashboard?.points?.[current]||{};
  const first=dayRows[0];
  const day=first?phuQuocDay(first.time_iso):null;
  if(title)title.textContent=(day?.date||selectedForecastDayKey)+" · "+(p.name||point().name||current);
  if(!engineDashboard){
    slots.innerHTML='<span class="inline-loader">Đang lấy các mốc từ JoTrip Engine...</span>';
    if(note)note.textContent="Đang tải dự báo theo điểm.";
    return;
  }
  if(!dayRows.length){
    slots.innerHTML='<div class="forecast-day-detail-empty">JoTrip Engine chưa có mốc point-level cho ngày này.</div>';
    if(note)note.textContent="Không dùng dữ liệu vùng để giả thành dữ liệu tại điểm.";
    return;
  }
  const step=engineDayStepHours(dayRows);
  if(note)note.textContent="JoTrip Engine · "+(step?("mốc "+fmt(step,0)+" giờ"):"mốc theo chu kỳ nguồn")+" · chạm ngày khác để đổi.";
  slots.innerHTML=dayRows.map(r=>{
    const rain=num(r.rain),wind=num(r.wind),gust=safeModelGust(r),wave=num(r.wave),temp=num(r.temperature);
    return '<article class="forecast-hour-slot">'+
      '<header><time>'+esc(phuQuocClock(r.time_iso))+'</time><span aria-hidden="true">'+todayWeatherIcon(r)+'</span></header>'+
      '<strong>'+(temp===null?'-':fmt(temp,0)+'°')+'</strong>'+
      '<div>'+
        '<span><b>Mưa</b><em>'+(rain===null?'-':fmt(rain,2)+' mm/mốc')+'</em></span>'+
        '<span><b>Gió</b><em>'+(wind===null?'-':fmt(wind,0)+' km/h')+'</em></span>'+
        '<span><b>Giật</b><em>'+(gust===null?'-':fmt(gust,0)+' km/h')+'</em></span>'+
        '<span><b>Sóng</b><em>'+(wave===null?'Chưa có theo giờ':fmt(wave,2)+' m')+'</em></span>'+
      '</div>'+
    '</article>';
  }).join("");
}
function toggleForecastDay(dayKey){
  selectedForecastDayKey=selectedForecastDayKey===dayKey?null:dayKey;
  renderJoTripForecast();
  renderForecastDayDetail();
  if(selectedForecastDayKey)$("forecastDayDetail")?.scrollIntoView({behavior:"smooth",block:"nearest"});
}

function renderJoTripForecast(){
  const title=$("jotripForecastTitle");
  const body=$("jotripForecastRows");
  const meta=regionMeta();
  const rows=futureForecastRows(regionRows());
  const fresh=regionalForecastFreshness();
  const cal=regionalForecast?.calibration_status||point().ensemble?.calibration_status||"LEARNING";
  if(fresh.stale)setBadge("ensembleState","UNAVAILABLE","DỮ LIỆU ĐANG TRỄ");
  else if(String(cal).toUpperCase()==="LEARNING")setBadge("ensembleState","LEARNING","XU HƯỚNG");
  else setBadge("ensembleState",cal,viCal(cal));

  const regionName=regionPublicName(currentRegion,meta);
  if(title)title.textContent=(regionalForecast?.horizon_hours>=240?"10 ngày tới":"Dự báo hiện có")+" - "+regionName;

  if(!regionalForecast||!meta){
    if(body)body.innerHTML='<tr><td colspan="8"><span class="inline-loader">Đang tải dự báo JoTrip theo vùng...</span></td></tr>';
    $("jotripForecastSummary").textContent="Đang tải dự báo cho khu vực này...";
    $("ensembleMeta").textContent="Đang cập nhật dữ liệu dự báo.";
    return;
  }

  renderForecastRegionTabs();
  renderForecastDayRibbon(rows);
  renderForecastDayDetail();
  const metaBox=$("forecastRegionMeta");
  if(metaBox){
    // Region names themselves are already traveller-facing. Keep the extra
    // representative-point taxonomy out of the main visual surface.
    metaBox.hidden=true;
    metaBox.innerHTML="";
  }

  if(!rows.length){
    body.innerHTML='<tr><td colspan="8"><div class="data-empty"><b>CHƯA ĐỦ DỮ LIỆU 10 NGÀY</b><span>Vùng này chưa có đủ dữ liệu dự báo tổ hợp để công bố.</span></div></td></tr>';
    $("jotripForecastSummary").textContent="JoTrip không lấy dự báo nguyên bản của một mô hình để lấp vào khi dữ liệu tổng hợp chưa đủ.";
    $("ensembleMeta").textContent="Dự báo JoTrip chưa sẵn sàng.";
    const ribbon=$("forecastDayRibbon");if(ribbon)ribbon.innerHTML='<span class="inline-loader">Chưa đủ dữ liệu để tóm tắt 10 ngày.</span>';
    return;
  }

  let watch=0;
  body.innerHTML=rows.map(r=>{
    let state=forecastCardState(r.wind_prob_30,r.rain_prob_5);
    const nowOverlay=r.nowcast_overlay||null;
    if(nowOverlay?.operational_impact===true&&["HIGH","ELEVATED"].includes(String(nowOverlay.level||"").toUpperCase()))state={label:"NOWCAST CẦN THEO DÕI",cls:"watch"};
    const variation=variationLevel({spread:r.wind_spread},{spread:r.rain_spread});
    if(state.cls==="watch"||variation.score>=3)watch++;
    const bft=beaufort(r.wind_kmh);
    const driver=[r.risk_driver?.rain,r.risk_driver?.wind,r.risk_driver?.nowcast].filter(Boolean);
    let driverText=[...new Set(driver)].join(" / ")||"-";
    if(nowOverlay&&num(nowOverlay.eta_minutes)!==null&&nowOverlay.approaching){
      driverText+=" · mây tới ~"+Math.round(nowOverlay.eta_minutes)+"p";
    }
    return '<tr class="'+state.cls+'">'+
      '<td><b>'+esc(r.valid_time?localTime(r.valid_time):("+"+fmt(r.lead_hours,0)+" giờ"))+'</b><small>Giờ Phú Quốc · UTC+7</small></td>'+
      '<td>'+fmt(r.temperature_c,1)+'°C</td>'+
      '<td><b>'+fmt(r.wind_kmh,0)+' km/h</b><small>q90 '+fmt(r.wind_q90_kmh,0)+' km/h</small></td>'+
      '<td><b>Bft '+bft.force+'</b><small>'+esc(bft.label)+'</small></td>'+
      '<td><b>~'+fmt(r.rain_mm,1)+' mm/mốc</b><small>q90 '+fmt(r.rain_q90_mm,1)+' mm</small></td>'+
      '<td><b>'+rowVariability(r)+'/100</b><small>'+variation.label.toLowerCase()+'</small></td>'+
      '<td><b>'+rowConfidence(r)+'/100</b><small>'+esc((r.confidence_band||"-").toLowerCase())+'</small></td>'+
      '<td>'+esc(driverText)+'</td>'+
    '</tr>';
  }).join("");

  const horizon=regionalForecast.horizon_hours||0;
  const nowcastContext=regionalForecast?.nowcast_context||{};
  const horizonText=horizon>=240
    ?"Xem nhanh xu hướng 10 ngày; 3 ngày đầu được theo dõi dày hơn."
    :"Hiện hệ thống có khoảng "+Math.round(horizon/24)+" ngày dự báo cho khu vực này.";
  const watchText=watch>=8
    ?" Có nhiều khung giờ cần để ý thêm, nhất là trong vài ngày đầu."
    :watch
      ?" Có "+watch+" khung giờ cần để ý thêm."
      :" Chưa thấy khung giờ nào nổi bật cần cảnh báo thêm.";
  const nowcastText=nowcastContext.applied
    ?" Mây vệ tinh mới nhất cũng được dùng để kiểm tra phần rất gần."
    :" Phần rất gần đang chờ ảnh vệ tinh mới hơn.";
  $("jotripForecastSummary").textContent=(fresh.stale
    ?"Dữ liệu dự báo đang cập nhật lại. Các ngày bên dưới chỉ nên xem như tham khảo lúc này. "
    :"")+horizonText+watchText+nowcastText;

  $("ensembleMeta").textContent="Dự báo JoTrip theo khu vực · "+
    fresh.text+
    " · càng xa ngày, độ chắc chắn càng giảm. Chi tiết chất lượng dữ liệu nằm ở phần nguồn bên dưới.";
}

function publicSourceName(key){
  const names={
    ECMWF:"ECMWF",
    GEFS:"NOAA GEFS",
    ICON:"ICON",
    COPERNICUS:"Copernicus Marine",
    RADAR_LIGHTNING:"Radar và sét",
    VVPQ:"Quan trắc VVPQ",
    VRAIN:"Mưa đo VRain",
    HIMAWARI:"Himawari",
    AQI:"Chất lượng không khí",
    TRIỀU:"Thủy triều"
  };
  return names[key]||key;
}
function renderHealth(){
  const src=critical.sources||{};
  const stLabel=st=>({PASS:"Sẵn sàng",PARTIAL:"Một phần",FAIL:"Chưa sẵn sàng",UNRESOLVED:"Chưa kết nối"}[st]||st.replaceAll("_"," ").toLowerCase());
  $("sourceGrid").innerHTML=Object.entries(src).map(([k,v])=>{
    const st=String(v.status||"UNRESOLVED").toUpperCase();
    const cls=st==="PASS"?"pass":st==="PARTIAL"?"partial":"fail";
    return '<article class="source-card"><header><b>'+esc(publicSourceName(k))+'</b><span class="source-state '+cls+'">'+esc(stLabel(st))+'</span></header><p>'+esc(v.detail||"")+'</p></article>';
  }).join("")||'<div class="lazy-status">Chưa có thông tin tình trạng nguồn.</div>';
  $("gapGrid").innerHTML=(critical.gaps||[]).length?(critical.gaps||[]).map(g=>'<div class="gap-card"><b>'+esc(g.name||"Phần còn thiếu")+'</b><span>'+esc(g.detail||"")+'</span></div>').join(""):'<div class="gap-card"><b>Không có khoảng trống nghiêm trọng</b><span>Chu kỳ hiện tại chưa ghi nhận lớp dữ liệu bắt buộc bị thiếu.</span></div>';
  $("cycleGrid").innerHTML=Object.entries(critical.source_cycles||{}).map(([k,v])=>'<span class="cycle-chip">'+esc(k)+' · '+localTime(v)+'</span>').join("");
  const headline=String(critical.headline||"").includes("Live D0-D10")?"Các nguồn đầu vào đã cập nhật. Trang chỉ công bố Dự báo JoTrip đã tổng hợp, không hiển thị riêng dự báo nguyên bản của từng mô hình.":(critical.headline||"-");
  const next=String(critical.next_review||"").includes("watch cycle")?"Trang public làm mới dữ liệu khoảng mỗi 10 phút; mô hình nặng cập nhật theo chu kỳ nguồn.":(critical.next_review||"-");
  $("auditGrid").innerHTML=
    '<div class="audit-item"><span>Mã lần cập nhật</span><b>'+esc(critical.snapshot_id||"-")+'</b></div>'+
    '<div class="audit-item"><span>Mã phiên bản</span><b>'+esc(critical.git_commit_sha||"-")+'</b></div>'+
    '<div class="audit-item wide"><span>Tóm tắt hệ thống</span><b>'+esc(headline)+'</b></div>'+
    '<div class="audit-item wide"><span>Lần kiểm tra tiếp</span><b>'+esc(next)+'</b></div>';
}


const INTRADAY_META={
  wind:{title:"Gió 72 giờ",unit:"km/h",note:"Ước tính hiện tại được nối với dự báo tổ hợp GEFS q50/q90 tới +72 giờ. 24 giờ đầu hiển thị theo từng giờ, ngày 2-3 theo mỗi 2 giờ bằng nội suy để dễ đọc; không làm tăng độ phân giải thật của mô hình."},
  rain:{title:"Mưa 72 giờ",unit:"mm/h",note:"Ước tính hiện tại và số đo VRain được giữ riêng. GEFS theo mốc 6 giờ được quy đổi về cường độ trung bình rồi nội suy để hiển thị theo 1 giờ/2 giờ; đây là cách trình bày diễn biến, không phải số đo từng giờ."},
  temperature:{title:"Nhiệt độ 72 giờ",unit:"°C",note:"Ước tính hiện tại + dự báo tổ hợp q50/q90. Ngày đầu hiển thị mỗi giờ, ngày 2-3 mỗi 2 giờ; các điểm giữa mốc nguồn được nội suy để dễ đọc."},
  wave:{title:"Sóng Hs 72 giờ",unit:"m",note:"Phần 72 giờ là dữ liệu mô hình. Ngày đầu hiển thị mỗi giờ, ngày 2-3 mỗi 2 giờ bằng nội suy giữa các mốc. Điểm thiếu chuỗi trực tiếp sẽ dùng điểm biển tham chiếu gần nhất và ghi rõ nguồn."},
  convective:{title:"Mức phát triển mây gần hiện tại",unit:"/100",note:"Chỉ số này dùng độ lạnh/độ cao đỉnh mây và xu hướng phát triển từ Himawari. Không phải xác suất mưa hay sét và không kéo giả tới 72 giờ."},
  tide:{title:"Triều 72 giờ",unit:"m",note:"Triều mô hình giữ chuỗi theo giờ để nhìn chính xác hơn thời điểm nước cao/thấp. Các mốc Cao/Thấp được đánh trực tiếp trên đồ thị."}
};
const H72=72*3600000;
const H1=3600000;
function localClock(iso){
  const d=new Date(iso);if(!Number.isFinite(d.getTime()))return null;
  const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Ho_Chi_Minh",hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(d);
  const h=Number(parts.find(x=>x.type==="hour")?.value||0),m=Number(parts.find(x=>x.type==="minute")?.value||0);
  return h+m/60;
}
function localDayKey(iso){
  const d=new Date(iso);if(!Number.isFinite(d.getTime()))return "";
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Ho_Chi_Minh",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(d);
  const g=t=>parts.find(x=>x.type===t)?.value||"";
  return g("year")+"-"+g("month")+"-"+g("day");
}
function localTickLabel(ms){
  const d=new Date(ms);
  const p=new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Ho_Chi_Minh",day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(d);
  const g=t=>p.find(x=>x.type===t)?.value||"";
  return {date:g("day")+"/"+g("month"),time:g("hour")+":"+g("minute")};
}
function localMidnightMs(ms){
  const offset=7*H1,day=24*H1;
  return Math.floor((ms+offset)/day)*day-offset;
}
function intradayHistory(){
  const rows=currentBundle?.today_series?.points?.[current];
  if(Array.isArray(rows)&&rows.length)return rows;
  const l=localPoint(),t=liveTimestamp();
  if(!t)return [];
  return [{
    time:t,
    temperature_c:num(l.temperature_c),
    wind_kmh:num(l.wind_kmh),
    rain_rate_mm_h:num(l.rain_rate_mm_h),
    wave_hs_m:num(l.wave_hs_m),
    convective_score:num(l.convection_score),
    data_class:"ESTIMATED_NOW"
  }];
}
function intradayActual(){
  if(current!=="duong_dong")return [];
  return Array.isArray(currentBundle?.today_series?.actual?.vvpq)?currentBundle.today_series.actual.vvpq:[];
}
function intradayForecast(){
  return Array.isArray(point().ensemble?.rows)?point().ensemble.rows:[];
}
function modelForecast72(){
  return Array.isArray(currentBundle?.model_72h?.points?.[current])?currentBundle.model_72h.points[current]:[];
}
function waveForecast72(){ return modelForecast72(); }

function forecastDisplayTargets(start,end){
  const targets=[];
  let t=Math.ceil(start/H1)*H1;
  while(t<=end){
    const hours=(t-start)/H1;
    targets.push(t);
    t+=hours<24?H1:2*H1;
  }
  return targets;
}
function interpolateRows(rows,start,end,anchor=null){
  let src=rows.slice().filter(r=>Number.isFinite(Date.parse(r.time))&&num(r.value)!==null).sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
  if(anchor&&num(anchor.value)!==null)src=[anchor,...src].sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
  if(src.length<2)return src;
  const out=[];
  for(const t of forecastDisplayTargets(start,end)){
    let lo=null,hi=null;
    for(let i=0;i<src.length-1;i++){
      const a=Date.parse(src[i].time),b=Date.parse(src[i+1].time);
      if(t>=a&&t<=b){lo=src[i];hi=src[i+1];break}
    }
    if(!lo||!hi)continue;
    const a=Date.parse(lo.time),b=Date.parse(hi.time),f=b===a?0:(t-a)/(b-a);
    const lerp=(x,y)=>{
      const nx=num(x),ny=num(y);
      if(nx===null&&ny===null)return null;
      if(nx===null)return ny;if(ny===null)return nx;
      return nx+(ny-nx)*f;
    };
    const near=f<.5?lo:hi;
    out.push({
      ...near,
      time:new Date(t).toISOString(),
      value:lerp(lo.value,hi.value),
      high:lerp(lo.high,hi.high),
      period_s:lerp(lo.period_s,hi.period_s),
      display_interpolated:true,
      source_interval_hours:Math.round((b-a)/H1*10)/10
    });
  }
  return out;
}
function tideExtrema(rows){
  const out=[];
  for(let i=1;i<rows.length-1;i++){
    const a=num(rows[i-1].value),b=num(rows[i].value),d=num(rows[i+1].value);
    if(a===null||b===null||d===null)continue;
    if((b>a&&b>=d)||(b>=a&&b>d))out.push({...rows[i],extreme:"HIGH"});
    else if((b<a&&b<=d)||(b<=a&&b<d))out.push({...rows[i],extreme:"LOW"});
  }
  const dedup=[];
  for(const r of out){
    const last=dedup[dedup.length-1];
    if(last&&last.extreme===r.extreme&&Math.abs(Date.parse(r.time)-Date.parse(last.time))<3*H1){
      if((r.extreme==="HIGH"&&r.value>last.value)||(r.extreme==="LOW"&&r.value<last.value))dedup[dedup.length-1]=r;
    }else dedup.push(r);
  }
  return dedup;
}
function renderIntradaySignal(){
  const el=$("intradaySignal");if(!el)return;
  const n=effectiveNowcast(),score=num(n.convective_score),g=nearestRainGauge();
  if(score===null){el.textContent="";el.className="intraday-signal";return}
  const dry=g&&(g.rain_observed===false||num(g.accum_mm)===0);
  let level="calm",label="Chưa thấy cụm mây mạnh";
  if(score>=85){level="strong";label="Cụm mây rất cao - nguy cơ mưa dông"}
  else if(score>=70){level="watch";label="Cụm mây rất cao - cần theo dõi"}
  else if(score>=50){level="watch";label="Mây đang phát triển"}
  el.className="intraday-signal "+level;
  el.textContent=label+" · "+Math.round(score)+"/100"+(dry?" · VRain gần nhất chưa mưa":"");
}

function chartDataset(layer){
  const now=Date.now(),start=now-H1,end=now+H72;
  let history=[],forecast=[],actual=[];
  const hist=intradayHistory().filter(r=>{
    const t=Date.parse(r.time);return Number.isFinite(t)&&t>=start&&t<=now+15*60*1000;
  });
  const ens=intradayForecast().filter(r=>{
    const t=Date.parse(r.valid_time);return Number.isFinite(t)&&t>=now-15*60*1000&&t<=end;
  });
  const model72=modelForecast72().filter(r=>{
    const t=Date.parse(r.time);return Number.isFinite(t)&&t>=now-15*60*1000&&t<=end;
  });

  if(layer==="wind"){
    history=hist.map(r=>({time:r.time,value:num(r.wind_kmh),kind:"estimated"})).filter(r=>r.value!==null);
    forecast=ens.length
      ?ens.map(r=>({time:r.valid_time,value:num(r.wind?.q50),high:num(r.wind?.q90),kind:"forecast"})).filter(r=>r.value!==null)
      :model72.map(r=>({time:r.time,value:num(r.wind_kmh),high:null,kind:"forecast_model",model_only:true})).filter(r=>r.value!==null);
    actual=intradayActual().filter(r=>{const t=Date.parse(r.time);return Number.isFinite(t)&&t>=start&&t<=now+15*60*1000}).map(r=>({time:r.time,value:num(r.wind_kmh),kind:"actual",source:"VVPQ"})).filter(r=>r.value!==null);
  }else if(layer==="rain"){
    history=hist.map(r=>({time:r.time,value:num(r.rain_rate_mm_h),kind:"estimated"})).filter(r=>r.value!==null);
    forecast=ens.length
      ?ens.map(r=>({time:r.valid_time,value:num(r.rain?.q50)===null?null:num(r.rain.q50)/6,high:num(r.rain?.q90)===null?null:num(r.rain.q90)/6,kind:"forecast"})).filter(r=>r.value!==null)
      :model72.map(r=>({time:r.time,value:num(r.rain_3h_mm)===null?null:num(r.rain_3h_mm)/3,high:null,kind:"forecast_model",model_only:true})).filter(r=>r.value!==null);
  }else if(layer==="temperature"){
    history=hist.map(r=>({time:r.time,value:num(r.temperature_c),kind:"estimated"})).filter(r=>r.value!==null);
    forecast=ens.length
      ?ens.map(r=>({time:r.valid_time,value:num(r.temperature?.q50),high:num(r.temperature?.q90),kind:"forecast"})).filter(r=>r.value!==null)
      :model72.map(r=>({time:r.time,value:num(r.temperature_c),high:null,kind:"forecast_model",model_only:true})).filter(r=>r.value!==null);
    actual=intradayActual().filter(r=>{const t=Date.parse(r.time);return Number.isFinite(t)&&t>=start&&t<=now+15*60*1000}).map(r=>({time:r.time,value:num(r.temperature_c),kind:"actual",source:"VVPQ"})).filter(r=>r.value!==null);
  }else if(layer==="wave"){
    history=hist.map(r=>({time:r.time,value:num(r.wave_hs_m),kind:"model"})).filter(r=>r.value!==null);
    forecast=waveForecast72().filter(r=>{const t=Date.parse(r.time);return Number.isFinite(t)&&t>=now-15*60*1000&&t<=end}).map(r=>({
      time:r.time,value:num(r.wave_hs_m),high:num(r.wave_hmax_m),kind:"forecast",period_s:num(r.period_s),
      reference_mode:r.reference_mode||null,reference_point:r.reference_point||null,reference_distance_km:num(r.reference_distance_km)
    })).filter(r=>r.value!==null);
  }else if(layer==="convective"){
    history=hist.map(r=>({time:r.time,value:num(r.convective_score),kind:"remote"})).filter(r=>r.value!==null);
  }else if(layer==="tide"){
    const t=effectiveTide();
    forecast=(t.series||[]).filter(r=>{const tt=Date.parse(r.time_iso);return Number.isFinite(tt)&&tt>=now-H1&&tt<=end}).map(r=>({time:r.time_iso,value:num(r.height_m),kind:"forecast"})).filter(r=>r.value!==null);
  }
  const sort=rows=>rows.sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
  history=sort(history);forecast=sort(forecast);actual=sort(actual);
  if(["wind","rain","temperature","wave"].includes(layer)&&forecast.length){
    const latest=history[history.length-1];
    const anchor=latest?{...latest,time:new Date(Math.max(Date.now(),Date.parse(latest.time))).toISOString(),kind:"estimated-anchor"}:null;
    forecast=interpolateRows(forecast,Date.now(),end,anchor);
  }
  return {history,forecast,actual,start,end};
}
function chartValueText(layer,v){
  if(num(v)===null)return "-";
  const d=layer==="temperature"?1:layer==="wind"||layer==="convective"?0:2;
  return fmt(v,d)+" "+INTRADAY_META[layer].unit;
}
function intradayTip(r,label,layer){
  const payload={
    time:localTime(r.time),
    label,
    value:chartValueText(layer,r.value),
    high:num(r.high)!==null?chartValueText(layer,r.high):null,
    period:num(r.period_s)!==null?fmt(r.period_s,1)+" s":null,
    interpolation:r.display_interpolated?("Điểm hiển thị nội suy từ mốc mô hình "+fmt(r.source_interval_hours,0)+"h; không tăng độ phân giải nguồn"):null,
    reference:r.reference_mode==="NEAREST_MARINE_SERIES"
      ?("Tham chiếu biển "+(critical?.points?.[r.reference_point]?.name||r.reference_point||"-")+
        (num(r.reference_distance_km)!==null?" · cách ô biển ~"+fmt(r.reference_distance_km,1)+" km":""))
      :null
  };
  return encodeURIComponent(JSON.stringify(payload));
}
function setIntradayFocus(encoded){
  const box=$("intradayFocus");if(!box)return;
  try{
    const p=typeof encoded==="string"?JSON.parse(decodeURIComponent(encoded)):encoded;
    box.innerHTML='<b>'+esc(p.time||"-")+'</b><span>'+esc(p.label||"")+' · '+esc(p.value||"-")+'</span>'+
      (p.high?'<small>Biên q90 / Hmax: '+esc(p.high)+'</small>':'')+
      (p.period?'<small>Chu kỳ sóng: '+esc(p.period)+'</small>':'')+
      (p.reference?'<small>'+esc(p.reference)+'</small>':'')+
      (p.interpolation?'<small>'+esc(p.interpolation)+'</small>':'');
  }catch{
    box.textContent="Chạm vào một điểm để xem số liệu.";
  }
}
function renderIntradayChart(){
  const svg=$("intradayChart");if(!svg||!critical)return;
  const meta=INTRADAY_META[intradayLayer]||INTRADAY_META.wind;
  const panel=document.querySelector(".intraday-panel");
  if(panel)panel.dataset.layer=intradayLayer;
  svg.dataset.layer=intradayLayer;
  renderIntradaySignal();
  $("intradayTitle").textContent=meta.title+" - "+(point().name||current);
  $("intradayNote").textContent=meta.note;
  document.querySelectorAll("[data-intraday]").forEach(b=>b.classList.toggle("active",b.dataset.intraday===intradayLayer));

  const data=chartDataset(intradayLayer);
  const all=[...data.history,...data.forecast,...data.actual];
  if(!all.length){
    svg.setAttribute("viewBox","0 0 960 270");
    svg.innerHTML='<text x="480" y="135" text-anchor="middle" class="chart-empty">Chưa đủ chuỗi 72 giờ cho layer này tại point đang chọn.</text>';
    $("intradayLegend").innerHTML="";
    $("intradayFocus").textContent="Chưa có chuỗi dữ liệu phù hợp.";
    $("intradayMeta").textContent="72 giờ tới · Giờ Phú Quốc UTC+7";
    return;
  }

  const W=960,H=270,L=54,R=20,T=22,B=48,CW=W-L-R,CH=H-T-B;
  svg.setAttribute("viewBox","0 0 "+W+" "+H);
  const values=all.flatMap(r=>[r.value,r.high]).filter(v=>num(v)!==null).map(Number);
  let ymin=Math.min(...values),ymax=Math.max(...values);
  if(["wind","rain","wave","convective"].includes(intradayLayer))ymin=0;
  if(intradayLayer==="convective")ymax=100;
  else if(intradayLayer==="temperature"){ymin=Math.floor(ymin-1);ymax=Math.ceil(ymax+1)}
  else if(intradayLayer==="tide"){const pad=Math.max(.05,(ymax-ymin)*.14);ymin-=pad;ymax+=pad}
  else ymax=Math.max(ymin+.1,ymax*1.14+.05);
  if(ymax<=ymin)ymax=ymin+1;

  const x=time=>{
    const tt=Date.parse(time);if(!Number.isFinite(tt))return L;
    return L+clamp((tt-data.start)/(data.end-data.start),0,1)*CW;
  };
  const xMs=tt=>L+clamp((tt-data.start)/(data.end-data.start),0,1)*CW;
  const y=value=>T+(ymax-Number(value))/(ymax-ymin)*CH;
  const poly=rows=>rows.map(r=>x(r.time).toFixed(1)+","+y(r.value).toFixed(1)).join(" ");
  let out="";

  for(let i=0;i<=4;i++){
    const yy=T+i*CH/4,val=ymax-i*(ymax-ymin)/4;
    out+='<line x1="'+L+'" y1="'+yy.toFixed(1)+'" x2="'+(W-R)+'" y2="'+yy.toFixed(1)+'" class="chart-grid"/>';
    out+='<text x="'+(L-8)+'" y="'+(yy+3).toFixed(1)+'" text-anchor="end" class="chart-axis-label">'+esc(fmt(val,intradayLayer==="wind"||intradayLayer==="convective"?0:1))+'</text>';
  }

  const firstMidnight=localMidnightMs(data.start);
  for(let t=firstMidnight;t<=data.end;t+=12*H1){
    if(t<data.start-30*60*1000)continue;
    const xx=xMs(t),lab=localTickLabel(t);
    out+='<line x1="'+xx.toFixed(1)+'" y1="'+T+'" x2="'+xx.toFixed(1)+'" y2="'+(H-B)+'" class="chart-time-grid"/>';
    out+='<text x="'+xx.toFixed(1)+'" y="'+(H-25)+'" text-anchor="middle" class="chart-axis-date">'+esc(lab.date)+'</text>';
    out+='<text x="'+xx.toFixed(1)+'" y="'+(H-10)+'" text-anchor="middle" class="chart-axis-label">'+esc(lab.time)+'</text>';
  }

  const renderHit=(r,key,label)=>{
    const xx=x(r.time),yy=y(r.value),tip=intradayTip(r,label,intradayLayer);
    return '<circle cx="'+xx.toFixed(1)+'" cy="'+yy.toFixed(1)+'" r="11" class="chart-hit" data-tip="'+tip+'" data-key="'+key+'"/>';
  };

  if(intradayLayer==="rain"){
    const bars=[...data.history,...data.forecast];
    bars.forEach((r,i)=>{
      const xx=x(r.time),yy=y(r.value),base=y(0),bw=r.kind==="forecast"?13:9;
      const label=r.kind==="forecast"?"Dự báo q50":"Ước tính hiện tại",tip=intradayTip(r,label,intradayLayer),key="r"+i;
      out+='<rect x="'+(xx-bw/2).toFixed(1)+'" y="'+Math.min(yy,base).toFixed(1)+'" width="'+bw+'" height="'+Math.max(2,Math.abs(base-yy)).toFixed(1)+'" rx="2" class="chart-bar '+(r.kind==="forecast"?"forecast":"")+'" data-key="'+key+'"/>';
      if(num(r.high)!==null){
        const hy=y(r.high);
        out+='<line x1="'+(xx-7).toFixed(1)+'" y1="'+hy.toFixed(1)+'" x2="'+(xx+7).toFixed(1)+'" y2="'+hy.toFixed(1)+'" class="chart-q90-cap"/>';
      }
      out+='<rect x="'+(xx-12).toFixed(1)+'" y="'+T+'" width="24" height="'+CH+'" class="chart-hit-rect" data-tip="'+tip+'" data-key="'+key+'"/>';
    });
  }else{
    if(data.forecast.length>1&&data.forecast.some(r=>num(r.high)!==null)){
      const upper=data.forecast.map(r=>({time:r.time,value:num(r.high)??r.value}));
      const polygon=[...upper,...[...data.forecast].reverse()].map(r=>x(r.time).toFixed(1)+","+y(r.value).toFixed(1)).join(" ");
      out+='<polygon points="'+polygon+'" class="chart-band"/>';
    }
    if(data.history.length>1)out+='<polyline points="'+poly(data.history)+'" class="chart-history"/>';
    if(data.forecast.length>1)out+='<polyline points="'+poly(data.forecast)+'" class="chart-forecast"/>';
    data.history.forEach((r,i)=>{
      const key="h"+i,label=intradayLayer==="wave"?"Mô hình":"Estimated Now";
      out+='<circle cx="'+x(r.time).toFixed(1)+'" cy="'+y(r.value).toFixed(1)+'" r="3.8" class="chart-point" data-key="'+key+'"/>'+renderHit(r,key,label);
    });
    data.forecast.forEach((r,i)=>{
      const key="f"+i,label=intradayLayer==="tide"?"Triều mô hình":intradayLayer==="wave"?"Sóng mô hình":r.model_only?"Mô hình dự phòng":"Dự báo q50";
      out+='<circle cx="'+x(r.time).toFixed(1)+'" cy="'+y(r.value).toFixed(1)+'" r="4" class="chart-point forecast" data-key="'+key+'"/>'+renderHit(r,key,label);
    });
    if(intradayLayer==="tide"){
      tideExtrema(data.forecast).forEach((r,i)=>{
        const xx=x(r.time),yy=y(r.value),high=r.extreme==="HIGH",lab=localTickLabel(Date.parse(r.time));
        const label=(high?"Triều cao ":"Triều thấp ")+lab.time;
        const tip=intradayTip(r,label,intradayLayer),key="tide-ext-"+i;
        out+='<circle cx="'+xx.toFixed(1)+'" cy="'+yy.toFixed(1)+'" r="5.5" class="tide-extreme '+(high?"high":"low")+'" data-key="'+key+'"/>';
        out+='<text x="'+xx.toFixed(1)+'" y="'+(yy+(high?-10:15)).toFixed(1)+'" text-anchor="middle" class="tide-extreme-label '+(high?"high":"low")+'">'+esc((high?"Cao ":"Thấp ")+lab.time)+'</text>';
        out+='<circle cx="'+xx.toFixed(1)+'" cy="'+yy.toFixed(1)+'" r="13" class="chart-hit" data-tip="'+tip+'" data-key="'+key+'"/>';
      });
    }
    data.actual.forEach((r,i)=>{
      const key="a"+i,label=(r.source||"ACTUAL")+" ACTUAL";
      out+='<circle cx="'+x(r.time).toFixed(1)+'" cy="'+y(r.value).toFixed(1)+'" r="4.8" class="chart-actual" data-key="'+key+'"/>'+renderHit(r,key,label);
    });
  }

  const nowX=xMs(Date.now());
  out+='<line x1="'+nowX.toFixed(1)+'" y1="'+T+'" x2="'+nowX.toFixed(1)+'" y2="'+(H-B)+'" class="chart-now"/>';
  out+='<text x="'+Math.min(W-R-24,nowX+5).toFixed(1)+'" y="'+(T+11)+'" class="chart-now-label">NOW</text>';
  svg.innerHTML=out;

  const focus=data.history[data.history.length-1]||data.actual[data.actual.length-1]||data.forecast[0];
  if(focus){
    const label=focus.kind==="actual"?"VVPQ đo thực":focus.kind==="forecast_model"?"Mô hình dự phòng":focus.kind==="forecast"?"Dự báo q50":intradayLayer==="wave"?"Mô hình":"Ước tính hiện tại";
    setIntradayFocus(intradayTip(focus,label,intradayLayer));
  }

  const legends=[];
  if(["wind","rain","temperature"].includes(intradayLayer)){
    legends.push('<span><i></i>Ước tính hiện tại</span><span><i class="forecast"></i>Dự báo q50</span><span><i class="q90"></i>Biên q90</span>');
    if(data.actual.length)legends.push('<span><i class="actual"></i>VVPQ ACTUAL</span>');
  }else if(intradayLayer==="convective")legends.push('<span><i></i>Himawari proxy / Local Now</span>');
  else if(intradayLayer==="wave")legends.push('<span><i></i>Hiện tại</span><span><i class="forecast"></i>Mô hình 72 giờ</span><span><i class="q90"></i>Hmax</span>');
  else legends.push('<span><i class="forecast"></i>Triều mô hình</span>');
  $("intradayLegend").innerHTML=legends.join("");
  $("intradayMeta").textContent="0-24h: 1 giờ · 24-72h: 2 giờ · UTC+7 · chạm điểm để xem số";
}

function renderAll(){
  if(!critical)return;
  renderPointTabs();renderStatus();renderHero();renderTodayDecision();renderActual();renderFeedbackPoint();renderMapConvective();renderQuickAlert();renderJoTripForecast();
  if($("deepWeatherDetails")?.open)renderTechnical();
}

async function loadAQI(){
  try{fullAQI=await getFirst(AQI,15*60*1000);renderAQI()}catch(e){console.warn("[Weather V2] AQI",e)}
}
async function loadTide(){
  try{fullTide=await getFirst(TIDE,30*60*1000);renderTide();if(intradayLayer==="tide")renderIntradayChart()}catch(e){
    console.warn("[Weather V2] tide",e);
    const el=$("tideSpark");if(el)el.innerHTML='<text x="300" y="65" text-anchor="middle" fill="#8b9ba5" font-size="10">Chưa tải được chuỗi triều 24h</text>';
  }
}
async function loadNowcast(){
  try{
    const results=await Promise.allSettled(NOWCAST.map(url=>getJSON(url,60*1000)));
    const candidates=results.filter(x=>x.status==="fulfilled")
      .map(x=>x.value).filter(x=>x?.status==="POINT_NUMERIC_READY"&&x?.points);
    if(!candidates.length)throw new Error("No valid nowcast");
    candidates.sort((a,b)=>Date.parse(b.sampled_time||0)-Date.parse(a.sampled_time||0));
    if(!fullNowcast||Date.parse(candidates[0].sampled_time||0)>=Date.parse(fullNowcast.sampled_time||0))
      fullNowcast=candidates[0];
    renderHero();renderTodayDecision();renderMapConvective();renderCurrent();renderCloudMotionTable();renderStatus();renderQuickAlert();refreshActiveMap();
  }catch(e){console.warn("[Weather V2] compact nowcast",e)}
}
async function loadRegionalForecast(){
  try{
    const candidate=await getJSON(JOTRIP_FORECAST,10*60*1000);
    if(engineDashboard&&!forecastCycleCompatible(candidate,engineDashboard)){
      throw new Error("STALE_REGIONAL_FORECAST_CYCLE");
    }
    regionalForecast=candidate;
    refreshSnapshotAuthority();
    const ids=Object.keys(regionalForecast?.regions||{});
    if(!ids.includes(currentRegion))currentRegion=ids[0]||currentRegion;
    renderJoTripForecast();renderStatus();renderQuickAlert();
  }catch(e){
    console.warn("[Weather V2] regional forecast",e);
    $("jotripForecastRows").innerHTML='<tr><td colspan="8"><div class="data-empty"><b>CHƯA TẢI ĐƯỢC DỰ BÁO VÙNG</b><span>Phần quan trắc hiện tại vẫn hoạt động bình thường.</span></div></td></tr>';
  }
}

function mapCandidates(){
  const now=new Date(),base=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate(),now.getUTCHours(),Math.floor(now.getUTCMinutes()/10)*10);
  return Array.from({length:14},(_,i)=>{
    const d=new Date(base-(i+2)*600000),hh=String(d.getUTCHours()).padStart(2,"0"),mm=String(d.getUTCMinutes()).padStart(2,"0");
    return {url:JMA+"ha1_b13_"+hh+mm+".jpg",time:d.toISOString()};
  });
}
function preloadImage(url){
  return new Promise(resolve=>{
    const img=new Image();
    img.onload=()=>resolve(true);
    img.onerror=()=>resolve(false);
    img.src=url+(url.includes("?")?"&":"?")+"t="+Date.now();
  });
}
function stopHimawariLoop(removeMap=false){
  if(himawariLoopTimer)clearInterval(himawariLoopTimer);
  himawariLoopTimer=null;
  if(removeMap&&himawariMap){
    try{himawariMap.remove()}catch{}
    himawariMap=null;
    himawariOverlay=null;
  }
}
async function startHimawariLoop(box,note,statusEl){
  stopHimawariLoop(true);
  himawariLoopPlaying=true;
  const L=await ensureLeaflet();

  box.innerHTML='<div class="himawari-loop himawari-georef"><div id="himawariMap" class="himawari-map" aria-label="Himawari IR Band 13 georeferenced map"></div><div class="himawari-ir-badge">JMA · IR B13 · 99–110°E · 7–16°N</div><div class="himawari-loop-bar"><button id="himawariLoopPlay" type="button" aria-label="Tạm dừng ảnh vệ tinh">❚❚</button><span id="himawariLoopTime">Đang tải chuỗi ảnh...</span><small id="himawariLoopCount"></small></div></div>';

  const candidates=mapCandidates();
  const checked=await Promise.all(candidates.map(async x=>({...x,ok:await preloadImage(x.url)})));
  const frames=checked.filter(x=>x.ok).slice(0,9).reverse();
  const time=$("himawariLoopTime"),count=$("himawariLoopCount"),play=$("himawariLoopPlay");
  if(!frames.length){
    if(note)note.textContent="Chưa tải được chuỗi ảnh Himawari IR trong lần này.";
    if(statusEl){statusEl.textContent="CHƯA TẢI";statusEl.className="badge deferred"}
    return;
  }

  himawariMap=L.map("himawariMap",{
    zoomControl:false,
    attributionControl:true,
    preferCanvas:true,
    minZoom:5,
    maxZoom:10
  });
  himawariMap.createPane("himawariImage");
  himawariMap.getPane("himawariImage").style.zIndex="360";
  himawariMap.createPane("himawariLabels");
  himawariMap.getPane("himawariLabels").style.zIndex="430";
  himawariMap.getPane("himawariLabels").style.pointerEvents="none";

  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png?key=cb1_3q98_1_d8112ce70cc7ec9b9276b0a0",{
    subdomains:"abcd",maxZoom:19,opacity:.78,
    attribution:'&copy; OpenStreetMap &copy; CARTO'
  }).addTo(himawariMap);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png?key=cb1_3q98_1_d8112ce70cc7ec9b9276b0a0",{
    subdomains:"abcd",maxZoom:19,pane:"himawariLabels",opacity:.90
  }).addTo(himawariMap);

  let i=0;
  himawariOverlay=L.imageOverlay(frames[0].url+"?t="+Date.now(),HIMAWARI_HA1_BOUNDS,{
    pane:"himawariImage",
    opacity:.78,
    interactive:false,
    crossOrigin:false
  }).addTo(himawariMap);

  L.circleMarker([10.2172,103.9593],{
    radius:4,weight:2,color:"#fff",fillColor:"#f0b741",fillOpacity:1
  }).bindTooltip("Phú Quốc",{permanent:false,direction:"top"}).addTo(himawariMap);

  himawariMap.fitBounds([[8.9,102.45],[11.55,105.45]],{padding:[8,8],animate:false});
  setTimeout(()=>himawariMap?.invalidateSize(),80);

  const show=()=>{
    const f=frames[i];
    if(himawariOverlay)himawariOverlay.setUrl(f.url+"?t="+Date.now());
    if(time)time.textContent=new Date(f.time).toLocaleString("vi-VN",{timeZone:"Asia/Ho_Chi_Minh",hour:"2-digit",minute:"2-digit",day:"2-digit",month:"2-digit",hour12:false});
    if(count)count.textContent=(i+1)+"/"+frames.length;
  };
  const tick=()=>{if(!himawariLoopPlaying)return;i=(i+1)%frames.length;show()};
  show();
  himawariLoopTimer=setInterval(tick,1800);
  play?.addEventListener("click",()=>{
    himawariLoopPlaying=!himawariLoopPlaying;
    play.textContent=himawariLoopPlaying?"❚❚":"▶";
    play.setAttribute("aria-label",himawariLoopPlaying?"Tạm dừng ảnh vệ tinh":"Chạy ảnh vệ tinh");
  });

  if(note)note.textContent="Himawari IR B13 · JMA High-Resolution Asia 1 được đặt theo đúng phạm vi công bố 99–110°E, 7–16°N. Phú Quốc nằm đúng trên nền bản đồ để đối chiếu mây, không dùng crop/marker ước lượng.";
  if(statusEl){statusEl.textContent="GẦN-LIVE";statusEl.className="badge remote"}
}
function ensureLeaflet(){
  if(window.L)return Promise.resolve(window.L);
  if(leafletPromise)return leafletPromise;
  leafletPromise=new Promise((resolve,reject)=>{
    if(!document.querySelector('link[data-leaflet]')){
      const link=document.createElement("link");
      link.rel="stylesheet";link.href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";link.dataset.leaflet="1";
      document.head.appendChild(link);
    }
    const existing=document.querySelector('script[data-leaflet]');
    if(existing){
      existing.addEventListener("load",()=>resolve(window.L),{once:true});
      existing.addEventListener("error",reject,{once:true});
      return;
    }
    const script=document.createElement("script");
    script.src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.async=true;script.dataset.leaflet="1";
    script.onload=()=>window.L?resolve(window.L):reject(new Error("Leaflet unavailable"));
    script.onerror=()=>reject(new Error("Leaflet failed to load"));
    document.head.appendChild(script);
  });
  return leafletPromise;
}
function pointCoords(id,p){
  const fallback={
    duong_dong:[10.2172,103.9593],an_thoi:[10.0191,104.015],ganh_dau:[10.37077,103.84472],
    rach_gia:[10.00677,105.07845],cua_can:[10.292693,103.914799],bai_thom:[10.411765,104.031055],
    ham_ninh:[10.18062,104.04463],bai_sao:[10.0572576,104.0363948]
  };
  const lat=num(p?.local?.reference_lat??p?.lat),lon=num(p?.local?.reference_lon??p?.lon);
  return lat!==null&&lon!==null?[lat,lon]:(fallback[id]||null);
}
function pointMapLevel(p){
  const l=p?.local||{};
  if(!localDataFresh()||!l.available)return -1;
  const rain=num(l.rain_rate_mm_h),wind=num(l.wind_kmh);
  if(rain===null&&wind===null)return -1;
  if((rain!==null&&rain>=7.5)||(wind!==null&&wind>=40))return 3;
  if((rain!==null&&rain>=2.5)||(wind!==null&&wind>=30))return 2;
  if((rain!==null&&rain>=.5)||(wind!==null&&wind>=22))return 1;
  return 0;
}
function pointMapColor(level){
  return level<0?"#a1adb4":["#4c8fae","#d5a62e","#df7e31","#c94e57"][Math.max(0,Math.min(3,level))];
}
function mapPopup(id,p){
  const l=p?.local||{},m=p?.model||{},n=effectiveNowcastFor(id);
  const cloud=cloudStateLabel(n),parts=[];
  if(localDataFresh()&&l.available){
    if(num(l.rain_rate_mm_h)!==null)parts.push("Mưa JoTrip "+fmt(l.rain_rate_mm_h,1)+" mm/h");
    if(num(l.wind_kmh)!==null)parts.push("Gió JoTrip "+fmt(l.wind_kmh,0)+" km/h");
  }
  if(freshEnough(m.marine_sampled_time,210)&&num(m.wave_hs_m)!==null)
    parts.push("Sóng nền mô hình "+fmt(m.wave_hs_m,1)+" m");
  return '<div class="jotrip-map-popup"><b>'+esc(p?.name||id)+'</b>'+
    '<span>'+esc(parts.join(" · ")||"Đang tổng hợp số liệu")+'</span>'+
    '<small>'+esc(cloud.label)+(cloud.detail?" · "+esc(cloud.detail):"")+'</small></div>';
}
const JOTRIP_SCENE_URL="/weather-scene-v3.html?embed=1&integrated=1&v=20260922-fresh2";
async function renderJoTripMap(){
  const box=$("mapBox"),note=$("mapNote"),state=$("mapState");
  if(!box)return;
  const existing=box.querySelector('iframe[data-jotrip-scene]');
  if(existing){
    if(existing.getAttribute("src")!==JOTRIP_SCENE_URL)existing.setAttribute("src",JOTRIP_SCENE_URL);
    box.classList.add("jotrip-scene-active");
    if(state){state.textContent="LIVE";state.className="badge actual"}
    return;
  }
  if(jotripMap){try{jotripMap.remove()}catch{} jotripMap=null}
  box.classList.add("jotrip-scene-active");
  box.innerHTML='<iframe data-jotrip-scene title="JoTrip Weather Scene - Phú Quốc" loading="eager" referrerpolicy="strict-origin-when-cross-origin" src="'+JOTRIP_SCENE_URL+'"></iframe>';
  const frame=box.firstChild;
  frame.onload=()=>{
    if(state){state.textContent="LIVE";state.className="badge actual"}
    if(note)note.textContent="Chọn Mây, Mưa, Gió hoặc Sóng ngay trên bản đồ. Kéo timeline để xem diễn biến theo thời gian; chạm bản đồ để đọc số tại điểm chọn.";
  };
  frame.onerror=()=>{
    if(state){state.textContent="CHƯA TẢI";state.className="badge deferred"}
    if(note)note.textContent="Chưa tải được Bản đồ JoTrip trong lần này. Các số liệu và phần dự báo khác của trang vẫn hoạt động bình thường.";
  };
}

function setMap(type){
  stopHimawariLoop(true);
  mapLayer=type;
  document.querySelectorAll("[data-map]").forEach(b=>b.classList.toggle("active",b.dataset.map===type));
  if(!mapStarted)return;
  const box=$("mapBox"),note=$("mapNote"),state=$("mapState");
  if(jotripMap&&type!=="jotrip"){try{jotripMap.remove()}catch{} jotripMap=null}
  if(type!=="jotrip") box?.classList.remove("jotrip-scene-active");
  if(state){state.textContent="ĐANG TẢI";state.className="badge deferred"}
  if(type==="jotrip"){renderJoTripMap();return}
  if(type==="himawari"){
    startHimawariLoop(box,note,state).catch(e=>{
      console.warn("[Weather V2] Himawari loop",e);
      note.textContent="Chưa tải được chuỗi ảnh Himawari trong lần này.";
      state.textContent="CHƯA TẢI";state.className="badge deferred";
    });
    return;
  }
  box.innerHTML='<iframe title="Weather map" loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe>';
  const frame=box.firstChild;
  frame.onload=()=>{state.textContent="SẴN SÀNG";state.className=type==="radar"?"badge remote":"badge model"};
  frame.src=WINDY[type]||WINDY.radar;
  const notes={
    radar:"Radar quan trắc được giữ nguyên để đối chiếu vùng mưa đang xuất hiện quanh đảo.",
    wind:"Windy - lớp gió được giữ nguyên để đối chiếu cấu trúc gió với JoTrip Local Now.",
    rain:"Windy - mưa dự báo được giữ nguyên để đối chiếu với VRain, Local Now và Dự báo JoTrip.",
    waves:"Windy - sóng được giữ nguyên để đối chiếu với lớp biển của JoTrip."
  };
  note.textContent=notes[type]||notes.radar;
}
function refreshActiveMap(){
  if(!mapStarted)return;
  if(mapLayer==="jotrip")return;
  if(mapLayer==="himawari"){setMap("himawari")}
}
function startMap(){
  if(mapStarted)return;
  mapStarted=true;
  setMap(mapLayer);
}
function installMapObserver(){
  const target=document.querySelector(".map-panel");
  if(!target)return;
  if(!("IntersectionObserver" in window)){defer(startMap,1200);return}
  const ob=new IntersectionObserver(entries=>{
    if(entries.some(e=>e.isIntersecting)){startMap();ob.disconnect()}
  },{rootMargin:"500px 0px"});
  ob.observe(target);
}

async function sendFeedbackRemote(item){
  const response=await fetch(FEEDBACK_ENDPOINT,{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify(item),
    cache:"no-store",
    keepalive:true
  });
  if(!response.ok)throw new Error("feedback_http_"+response.status);
  let body={};
  try{body=await response.json()}catch{}
  return body;
}
function readFeedbackQueue(){
  try{
    const q=JSON.parse(localStorage.getItem(FEEDBACK_QUEUE_KEY)||"[]");
    return Array.isArray(q)?q:[];
  }catch{return []}
}
function writeFeedbackQueue(q){
  localStorage.setItem(FEEDBACK_QUEUE_KEY,JSON.stringify((q||[]).slice(-100)));
}
function feedbackCategoryFromRecord(x){
  const direct=String(x?.category||"").toUpperCase();
  if(direct)return direct;
  const m=String(x?.note||"").match(/category=([A-Z_]+)/);
  if(m)return m[1];
  if(x?.rain_relation==="higher")return "RAIN_MORE";
  if(x?.rain_relation==="lower")return "RAIN_LESS";
  if(x?.wind_relation==="higher")return "WIND_MORE";
  if(x?.wind_relation==="lower")return "WIND_LESS";
  return null;
}
function localFeedbackHistory(){
  try{
    const rows=JSON.parse(localStorage.getItem(FEEDBACK_HISTORY_KEY)||"[]");
    return Array.isArray(rows)?rows:[];
  }catch{return []}
}
function combinedRecentFeedback(minutes=90){
  const cutoff=Date.now()-minutes*60000;
  const remote=Array.isArray(recentFieldFeedback?.items)?recentFieldFeedback.items:[];
  const local=localFeedbackHistory();
  const seen=new Set(),rows=[];
  [...local,...remote].forEach(x=>{
    const t=Date.parse(x?.observed_at||"");
    if(!Number.isFinite(t)||t<cutoff)return;
    const key=x.id||[x.point_id,x.observed_at,feedbackCategoryFromRecord(x)].join("|");
    if(seen.has(key))return;
    seen.add(key);rows.push(x);
  });
  return rows.sort((a,b)=>Date.parse(b.observed_at||0)-Date.parse(a.observed_at||0));
}
function recentFeedbackFor(pointId,category){
  return combinedRecentFeedback().find(x=>x.point_id===pointId&&feedbackCategoryFromRecord(x)===category)||null;
}
async function loadRecentFeedback(){
  try{recentFieldFeedback=await getJSON(RECENT_FEEDBACK_ENDPOINT,60*1000)}
  catch{recentFieldFeedback=null}
  if(critical){
    renderQuickAlert();
    renderHazardBoard();
    renderCurrent();
    const summary=$("islandSummary");
    if(summary){
      const watches=buildQuickWatchEvents().slice(0,2);
      if(watches.length)summary.innerHTML="<b>Hiện cần chú ý:</b> "+watches.map(x=>esc(x.title)+(x.detail?" - "+esc(x.detail):"")).join("<br>")+"<small>Tin nhanh tự biến mất khi dữ liệu mới cho thấy tình huống đã qua.</small>";
    }
  }
  return recentFieldFeedback;
}
function saveFeedbackHistory(item){
  let h=[];
  try{h=JSON.parse(localStorage.getItem(FEEDBACK_HISTORY_KEY)||"[]")}catch{}
  if(!Array.isArray(h))h=[];
  h.push(item);
  try{localStorage.setItem(FEEDBACK_HISTORY_KEY,JSON.stringify(h.slice(-100)))}catch{}
  return h.length;
}
function queueFeedback(item){
  const q=readFeedbackQueue();
  if(!q.some(x=>x?.id===item.id))q.push(item);
  try{writeFeedbackQueue(q)}catch{}
  return q.length;
}
function dequeueFeedback(id){
  const q=readFeedbackQueue().filter(x=>x?.id!==id);
  try{writeFeedbackQueue(q)}catch{}
  return q.length;
}
function feedbackMessage(message,kind="ok"){
  const state=$("feedbackState"),toast=$("feedbackToast");
  if(state)state.textContent=message;
  if(toast){
    toast.textContent=message;
    toast.classList.remove("error");
    if(kind==="error")toast.classList.add("error");
    toast.classList.add("show");
    clearTimeout(feedbackMessage._timer);
    feedbackMessage._timer=setTimeout(()=>toast.classList.remove("show","error"),2800);
  }
}
async function flushFeedbackQueue(){
  const q=readFeedbackQueue();
  if(!q.length)return {sent:0,pending:0};
  let sent=0;
  for(const item of q){
    try{
      await sendFeedbackRemote(item);
      dequeueFeedback(item.id);
      sent++;
    }catch(e){
      console.warn("[Weather V2] feedback retry",e);
      break;
    }
  }
  return {sent,pending:readFeedbackQueue().length};
}
async function feedback(kind,button){
  const feedbackPoint=current;
  const p=critical?.points?.[feedbackPoint]||point(),l=p.local||{};
  const labels={
    MATCH:"Khớp",
    RAIN_MORE:"Mưa nhiều hơn",
    RAIN_LESS:"Mưa ít hơn",
    WIND_MORE:"Gió mạnh hơn",
    WIND_LESS:"Gió yếu hơn",
    THUNDER:"Có dông"
  };
  const legacy={
    MATCH:{verdict:"accurate",wind_relation:"about",wave_relation:"about",rain_relation:"about"},
    RAIN_MORE:{verdict:"wrong",wind_relation:"unknown",wave_relation:"unknown",rain_relation:"higher"},
    RAIN_LESS:{verdict:"wrong",wind_relation:"unknown",wave_relation:"unknown",rain_relation:"lower"},
    WIND_MORE:{verdict:"wrong",wind_relation:"higher",wave_relation:"unknown",rain_relation:"unknown"},
    WIND_LESS:{verdict:"wrong",wind_relation:"lower",wave_relation:"unknown",rain_relation:"unknown"},
    THUNDER:{verdict:"close",wind_relation:"unknown",wave_relation:"unknown",rain_relation:"unknown"}
  }[kind]||{verdict:"close",wind_relation:"unknown",wave_relation:"unknown",rain_relation:"unknown"};
  const item={
    schema_version:"1.2",
    id:(globalThis.crypto&&crypto.randomUUID)?crypto.randomUUID():String(Date.now()),
    observed_at:isoUTC7(),
    point_id:feedbackPoint,
    point_name:p.name||feedbackPoint,
    category:kind,
    category_label:labels[kind]||kind,
    verdict:legacy.verdict,
    wind_relation:legacy.wind_relation,
    wave_relation:legacy.wave_relation,
    rain_relation:legacy.rain_relation,
    evidence_type:"field_observation",
    evidence_class:"FIELD_FEEDBACK_UNVERIFIED",
    accepted_as_ground_truth:false,
    engine:critical?.source_state?.local_engine||"PQ_LOCAL_NOW_V2",
    snapshot_id:critical?.snapshot_id||null,
    source_cycles:critical?.source_cycles||null,
    estimate:{
      temperature_c:l.temperature_c,
      wind_kmh:l.wind_kmh,
      rain_rate_mm_h:l.rain_rate_mm_h,
      rain_confidence:l.rain_confidence,
      wave_hs_m:p?.marine?.wave_hs_m??null
    }
  };

  saveFeedbackHistory(item);
  const pending=queueFeedback(item);

  document.querySelectorAll("[data-feedback]").forEach(b=>b.classList.toggle("selected",b===button));
  if(button){
    button.setAttribute("aria-pressed","true");
    setTimeout(()=>{button.classList.remove("selected");button.removeAttribute("aria-pressed")},1600);
  }
  if(navigator.vibrate)navigator.vibrate(25);

  feedbackMessage("Đang gửi phản hồi về JoTrip...");
  try{
    await sendFeedbackRemote(item);
    const left=dequeueFeedback(item.id);
    feedbackMessage("Đã gửi về JoTrip · "+(labels[kind]||kind)+" · "+(p.name||feedbackPoint)+(left?" · còn "+left+" phản hồi chờ gửi":""));
    flushFeedbackQueue();
  }catch(e){
    console.warn("[Weather V2] feedback send",e);
    feedbackMessage("Đã lưu trên thiết bị · sẽ tự gửi lại khi có mạng ("+pending+" chờ gửi)");
  }
}
function shareWeather(){
  const data={title:"JoTrip Weather - Phú Quốc",text:"Theo dõi thời tiết hiện tại, biển, chất lượng không khí và Dự báo JoTrip 10 ngày cho Phú Quốc.",url:location.href};
  if(navigator.share){navigator.share(data).catch(()=>{})}
  else if(navigator.clipboard){navigator.clipboard.writeText(location.href).then(()=>{const b=$("shareWeather");if(b)b.textContent="Đã sao chép link"})}
}
function setDismissedPanel(id,dismissed){
  const target=document.getElementById(id||"");
  if(!target)return;
  target.hidden=Boolean(dismissed);
  document.querySelectorAll("[data-open-target]").forEach(btn=>{
    if(btn.dataset.openTarget===id)btn.hidden=!dismissed;
  });
}
function events(){
  document.addEventListener("click",e=>{
    const close=e.target.closest("[data-close-target]");
    if(close){
      setDismissedPanel(close.dataset.closeTarget||"",true);
      return;
    }
    const open=e.target.closest("[data-open-target]");
    if(open){
      setDismissedPanel(open.dataset.openTarget||"",false);
    }
  });
  document.addEventListener("keydown",e=>{
    if(e.key!=="Escape")return;
    const target=[...document.querySelectorAll("[data-esc-close]")].find(el=>!el.hidden);
    if(target)setDismissedPanel(target.id,true);
  });
  $("technicalPointTabs")?.addEventListener("click",e=>{
    const b=e.target.closest("[data-technical-point]");if(!b)return;
    current=b.dataset.technicalPoint;
    const linkedRegion=regionForPoint(current);if(linkedRegion)currentRegion=linkedRegion;
    renderAll();renderForecastDayDetail();refreshActiveMap();
  });
  $("pointTabs")?.addEventListener("click",e=>{
    const compare=e.target.closest("[data-compare]");
    if(compare?.dataset.compare==="ha_tien"){
      startMap();setMap("jotrip");
      document.querySelector(".command-center")?.scrollIntoView({behavior:"smooth",block:"start"});
      return;
    }
    const b=e.target.closest("[data-point]");if(!b)return;
    current=b.dataset.point;
    const linkedRegion=regionForPoint(current);if(linkedRegion)currentRegion=linkedRegion;
    renderAll();renderForecastDayDetail();refreshActiveMap();
  });
  document.querySelectorAll("[data-map]").forEach(b=>b.addEventListener("click",()=>{startMap();setMap(b.dataset.map)}));
  $("intradayTabs")?.addEventListener("click",e=>{
    const b=e.target.closest("[data-intraday]");if(!b)return;
    intradayLayer=b.dataset.intraday||"wind";
    renderIntradayChart();
  });
  $("intradayChart")?.addEventListener("click",e=>{
    const el=e.target.closest("[data-tip]");if(!el)return;
    const key=el.dataset.key;
    document.querySelectorAll("#intradayChart [data-key]").forEach(node=>node.classList.toggle("selected",Boolean(key)&&node.dataset.key===key));
    setIntradayFocus(el.dataset.tip||"");
  });
  const scrollForecastDays=dir=>{
    const ribbon=$("forecastDayRibbon");if(!ribbon)return;
    const card=ribbon.querySelector(".forecast-day");
    const step=(card?.getBoundingClientRect().width||150)+10;
    ribbon.scrollBy({left:dir*step*2,behavior:"smooth"});
  };
  $("forecastDayPrev")?.addEventListener("click",()=>scrollForecastDays(-1));
  $("forecastDayNext")?.addEventListener("click",()=>scrollForecastDays(1));
  $("forecastDayRibbon")?.addEventListener("wheel",e=>{
    if(Math.abs(e.deltaY)<=Math.abs(e.deltaX))return;
    const ribbon=e.currentTarget;
    if(ribbon.scrollWidth<=ribbon.clientWidth)return;
    e.preventDefault();
    ribbon.scrollLeft+=e.deltaY;
  },{passive:false});
  $("forecastDayRibbon")?.addEventListener("click",e=>{
    const card=e.target.closest("[data-forecast-day]");if(!card)return;
    toggleForecastDay(card.dataset.forecastDay);
  });
  $("forecastDayRibbon")?.addEventListener("keydown",e=>{
    if(!["Enter"," "].includes(e.key))return;
    const card=e.target.closest("[data-forecast-day]");if(!card)return;
    e.preventDefault();toggleForecastDay(card.dataset.forecastDay);
  });
  $("forecastDayDetailClose")?.addEventListener("click",()=>{
    selectedForecastDayKey=null;renderJoTripForecast();renderForecastDayDetail();
  });
  $("forecastRegionTabs")?.addEventListener("click",e=>{
    const b=e.target.closest("[data-region]");if(!b)return;
    currentRegion=b.dataset.region;renderJoTripForecast();
  });
  document.addEventListener("click",e=>{
    const b=e.target.closest("[data-feedback]");
    if(!b)return;
    e.preventDefault();
    feedback(b.dataset.feedback,b);
  });
  $("deepWeatherDetails")?.addEventListener("toggle",e=>{
    if(e.currentTarget.open){
      renderTechnical();
      Promise.allSettled([loadTide(),loadAQI()]).then(()=>renderTechnical());
    }
  });
  $("shareWeather")?.addEventListener("click",shareWeather);
}

function registerWeatherWorker(){
  if(!("serviceWorker" in navigator))return;
  navigator.serviceWorker.register("/weather-sw.js",{scope:"/"}).catch(e=>console.warn("[Weather] service worker",e));
}
async function refreshLive(){
  if(liveRefreshBusy)return;
  liveRefreshBusy=true;
  try{
    const next=await getCriticalWithFreshLocal();
    critical=next;
    if(!critical?.points?.[current])current=critical.default_point||"duong_dong";
    renderAll();
    refreshActiveMap();
    lastLiveRefreshAt=Date.now();
    const jobs=[loadEngineDashboard(),loadRegionalForecast(),loadRecentFeedback(),loadNowcast()];
    if($("deepWeatherDetails")?.open)jobs.push(loadTide(),loadAQI());
    await Promise.allSettled(jobs);
  }catch(e){
    console.warn("[Weather V2] live refresh",e);
    renderStatus();
    setTimeout(()=>{if(document.visibilityState==="visible")refreshLive()},60000);
  }finally{
    liveRefreshBusy=false;
  }
}
async function boot(){
  registerWeatherWorker();
  events();
  try{
    critical=await getCriticalWithFreshLocal();
    current=critical.default_point||"duong_dong";
    currentRegion=regionForPoint(current)||currentRegion;
    lastLiveRefreshAt=Date.now();
    renderAll();
    installMapObserver();
    defer(loadEngineDashboard,120);
    if(!fullNowcast)defer(loadNowcast,450);
    defer(loadRegionalForecast,620);
    defer(loadRecentFeedback,850);
    setInterval(()=>{renderStatus();renderHero();renderTodayDecision();renderQuickAlert()},60000);
    setInterval(refreshLive,LIVE_REFRESH_MS);
    setInterval(()=>{if(mapLayer==="himawari"&&document.visibilityState==="visible")refreshActiveMap()},10*60*1000);
    document.addEventListener("visibilitychange",()=>{
      if(document.visibilityState==="visible"&&Date.now()-lastLiveRefreshAt>5*60*1000)refreshLive();
    });
    window.addEventListener("online",()=>{
      if(Date.now()-lastLiveRefreshAt>2*60*1000)refreshLive();
      flushFeedbackQueue();
    });
    setTimeout(flushFeedbackQueue,1800);
    setInterval(flushFeedbackQueue,5*60*1000);
  }catch(e){
    $("heroSummary").textContent="Không tải được dữ liệu ban đầu. Bạn thử tải lại trang giúp mình.";
    $("liveLabel").textContent="LỖI DỮ LIỆU";$("liveDot").className="warn";
    console.error(e);
  }
}
boot();
})();