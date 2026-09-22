(()=>{"use strict";

const RUNTIME=window.JOTRIP_WEATHER_RUNTIME;
if(!RUNTIME) throw new Error("JoTrip Weather canonical runtime registry missing");
const URLS={
  manifest:RUNTIME.manifest,
  nowcast:RUNTIME.cloud,
  compact:RUNTIME.compact,
  current:RUNTIME.current,
  ecmwf:RUNTIME.forecast,
  dashboard:RUNTIME.meta,
  marine:RUNTIME.marine
};

const CARTO_KEY="cb1_3q98_1_d8112ce70cc7ec9b9276b0a0";
const NAMES={
  duong_dong:"Dương Đông",an_thoi:"An Thới",ganh_dau:"Gành Dầu",
  cua_can:"Cửa Cạn",bai_thom:"Bãi Thơm",ham_ninh:"Hàm Ninh",bai_sao:"Bãi Sao"
};
const $=id=>document.getElementById(id);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const num=v=>v===null||v===undefined||v===""||Number.isNaN(Number(v))?null:Number(v);

const EMBED=new URLSearchParams(location.search).get("embed")==="1";
const HOME_VIEW={lat:10.20,lon:103.98,mobileZoom:9.65,desktopZoom:10.25};
const PROCESSING_BOUNDS=[[9.00,102.75],[11.00,105.50]];
const PROBE_BOUNDS={south:9.00,north:11.00,west:102.75,east:105.50};
function probeAllowed(lat,lon){
  return lat>=PROBE_BOUNDS.south&&lat<=PROBE_BOUNDS.north&&lon>=PROBE_BOUNDS.west&&lon<=PROBE_BOUNDS.east;
}

const state={
  map:null,
  nowcast:null,
  compact:null,
  current:null,
  ecmwf:null,
  dashboard:null,
  marine:null,
  scene:"cloud",
  frames:[],
  index:0,
  playing:false,
  timer:null,
  raf:null,
  particleRaf:null,
  particles:[],
  actualLayer:null,
  anchorLayer:null,
  selectedMarker:null,
  probe:null,
  runtimeManifest:null,
  sources:{manifest:false,nowcast:false,compact:false,current:false,ecmwf:false,dashboard:false,marine:false}
};

async function fetchJSON(url){
  const r=await fetch(url+(url.includes("?")?"&":"?")+"t="+Date.now(),{cache:"no-store"});
  if(!r.ok) throw new Error("HTTP "+r.status+" "+url);
  return r.json();
}
async function fetchCanonical(url){
  return fetchJSON(url);
}
function stamp(iso){
  if(!iso) return "--";
  const d=new Date(iso);
  if(Number.isNaN(d.getTime())) return "--";
  return new Intl.DateTimeFormat("vi-VN",{
    timeZone:"Asia/Ho_Chi_Minh",day:"2-digit",month:"2-digit",
    hour:"2-digit",minute:"2-digit",hour12:false
  }).format(d).replace(","," ·");
}
function utcCycleLabel(iso){
  const t=Date.parse(iso||"");
  if(!Number.isFinite(t)) return "--";
  const d=new Date(t);
  return String(d.getUTCHours()).padStart(2,"0")+"Z";
}
function localRunLabel(iso){
  if(!iso) return "--";
  return stamp(iso);
}
function modelRunIso(scene){
  const cycles=state.dashboard?.source_cycles||{};
  if(scene==="rain"||scene==="wind"||scene==="wave") return cycles.ECMWF||state.ecmwf?.run_time||state.ecmwf?.spatial?.short_run_time||null;
  return null;
}
function modelName(scene){
  if(scene==="rain"||scene==="wind") return "ECMWF IFS";
  if(scene==="wave") return "ECMWF Wave";
  return "Himawari-9";
}
function ageMinutes(iso){
  const t=Date.parse(iso||"");
  return Number.isFinite(t)?Math.max(0,(Date.now()-t)/60000):null;
}
function agePhraseFromMinutes(a){
  if(a===null||!Number.isFinite(a))return "không rõ thời gian";
  if(a<2)return "vừa cập nhật";
  if(a<60)return Math.round(a)+" phút trước";
  const h=Math.floor(a/60),m=Math.round(a-h*60);
  if(m<8)return h+" giờ trước";
  return h+" giờ "+m+" phút trước";
}
function modelCycleBadge(scene){
  const run=modelRunIso(scene);
  if(!run)return {text:"đang chờ dữ liệu dự báo",stale:true};
  const a=ageMinutes(run),stale=(a||Infinity)>12*60;
  return {
    text:stale?"đang chờ dự báo mới · "+agePhraseFromMinutes(a):agePhraseFromMinutes(a),
    stale
  };
}
function freshnessText(iso,kind){
  const a=ageMinutes(iso);
  if(a===null)return {text:"không rõ thời gian",stale:true};
  const staleLimit=kind==="satellite"?35:kind==="actual"?90:kind==="marine"?210:420;
  const prefix=kind==="satellite"?"ảnh vệ tinh ":kind==="marine"?"biển ":"";
  return {text:prefix+agePhraseFromMinutes(a),stale:a>staleLimit};
}

function initMap(){
  state.map=L.map("map",{
    zoomControl:false,attributionControl:true,
    minZoom:0,maxZoom:12.2,zoomSnap:.25,zoomDelta:.5,preferCanvas:true,
    maxBounds:PROCESSING_BOUNDS,maxBoundsViscosity:1
  });
  const initialZoom=innerWidth<760?HOME_VIEW.mobileZoom:HOME_VIEW.desktopZoom;
  state.map.setView([HOME_VIEW.lat,HOME_VIEW.lon],initialZoom,{animate:false});

  const enforceNavigationContract=()=>{
    const bounds=L.latLngBounds(PROCESSING_BOUNDS);
    const minZoom=state.map.getBoundsZoom(bounds,true,L.point(12,12));
    state.map.setMinZoom(minZoom);
    state.map.setMaxBounds(bounds);
    if(state.map.getZoom()<minZoom)state.map.setZoom(minZoom,{animate:false});
    state.map.panInsideBounds(bounds,{animate:false});
    document.documentElement.dataset.sceneMinZoom=Number(minZoom).toFixed(2);
    document.documentElement.dataset.sceneProcessingBounds="9.00,102.75,11.00,105.50";
  };
  enforceNavigationContract();

  state.map.createPane("sceneLabels");
  const labelPane=state.map.getPane("sceneLabels");
  labelPane.classList.add("scene-label-pane");
  labelPane.style.zIndex="650";
  labelPane.style.pointerEvents="none";

  L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/rastertiles/light_nolabels/{z}/{x}/{y}{r}.png?key="+CARTO_KEY,
    {subdomains:"abcd",maxZoom:19,attribution:"&copy; OpenStreetMap &copy; CARTO"}
  ).addTo(state.map);

  L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/rastertiles/light_only_labels/{z}/{x}/{y}{r}.png?key="+CARTO_KEY,
    {subdomains:"abcd",maxZoom:19,pane:"sceneLabels"}
  ).addTo(state.map);

  state.map.createPane("sceneAnchor");
  const anchorPane=state.map.getPane("sceneAnchor");
  anchorPane.classList.add("scene-anchor-pane");
  anchorPane.style.zIndex="500";
  anchorPane.style.pointerEvents="none";
  anchorPane.style.filter="grayscale(1) contrast(1.35)";
  state.anchorLayer=L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/rastertiles/light_nolabels/{z}/{x}/{y}{r}.png?key="+CARTO_KEY,
    {subdomains:"abcd",maxZoom:19,pane:"sceneAnchor",opacity:.30,className:"scene-anchor-tiles"}
  ).addTo(state.map);

  state.map.createPane("weatherCanvas");
  const weatherPane=state.map.getPane("weatherCanvas");
  weatherPane.classList.add("weather-canvas-pane");
  weatherPane.style.zIndex="350";
  weatherPane.style.pointerEvents="none";
  const field=$("fieldCanvas"), motion=$("motionCanvas");
  weatherPane.appendChild(field);
  weatherPane.appendChild(motion);
  field.style.zIndex="1";
  motion.style.zIndex="2";
  field.style.pointerEvents="none";
  motion.style.pointerEvents="none";

  state.actualLayer=L.layerGroup().addTo(state.map);

  const publishViewContract=()=>{
    const b=state.map.getBounds(),c=state.map.getCenter();
    document.documentElement.dataset.sceneLatSpan=(b.getNorth()-b.getSouth()).toFixed(3);
    document.documentElement.dataset.sceneLonSpan=(b.getEast()-b.getWest()).toFixed(3);
    document.documentElement.dataset.sceneCenterLat=Number(c.lat).toFixed(5);
    document.documentElement.dataset.sceneCenterLon=Number(c.lng).toFixed(5);
    document.documentElement.dataset.sceneSouth=Number(b.getSouth()).toFixed(5);
    document.documentElement.dataset.sceneNorth=Number(b.getNorth()).toFixed(5);
    document.documentElement.dataset.sceneWest=Number(b.getWest()).toFixed(5);
    document.documentElement.dataset.sceneEast=Number(b.getEast()).toFixed(5);
    document.documentElement.dataset.sceneZoom=Number(state.map.getZoom()).toFixed(2);
  };
  state.map.on("move zoom resize",queueRender);
  state.map.on("moveend zoomend",publishViewContract);
  state.map.on("resize",()=>{enforceNavigationContract();publishViewContract()});
  setTimeout(()=>{enforceNavigationContract();publishViewContract()},80);
  state.map.on("click",e=>{
    if(!probeAllowed(e.latlng.lat,e.latlng.lng)){
      if(state.selectedMarker){
        state.map.removeLayer(state.selectedMarker);
        state.selectedMarker=null;
      }
      state.probe=null;
      document.querySelector(".map-shell")?.classList.remove("has-selection");
      return;
    }
    state.probe={lat:e.latlng.lat,lon:e.latlng.lng};
    placeSelectionFlag(e.latlng.lat,e.latlng.lng);
    updateSourcePanel();
  });
}

function cloudFrames(){
  const age=ageMinutes(state.nowcast?.sampled_time);
  if(age===null||age>35)return [];
  return state.nowcast?.spatial?.frames||[];
}
function forecastFrames(){
  const all=state.ecmwf?.spatial?.frames||[];
  const now=Date.now(), max=now+72*3600e3;
  const sliced=all.filter(f=>{
    const t=Date.parse(f.valid_time||"");
    return Number.isFinite(t)&&t>=now-4*3600e3&&t<=max;
  });
  return sliced; // No old forecast frames disguised as near-now when a cycle has expired.
}
function forecastFramesFor(scene){
  const key=scene==="rain"?"rain_mm":scene==="wind"?"u10_ms":scene==="wave"?"wave_hs_m":null;
  if(!key)return forecastFrames();
  return forecastFrames().filter(f=>(f.cells||[]).some(c=>{
    if(scene==="wind")return num(c.u10_ms)!==null&&num(c.v10_ms)!==null;
    return num(c[key])!==null;
  }));
}
function marineWaveFrame(){
  const wave=state.marine?.wave;
  if(!wave||wave.status!=="READY"||!(wave.cells||[]).length||!wave.sampled_time)return null;
  if((ageMinutes(wave.sampled_time)??Infinity)>210)return null;
  return {
    sampled_time:wave.sampled_time,
    valid_time:wave.sampled_time,
    data_class:"OBSERVED_MARINE",
    source:"COPERNICUS_MARINE",
    cells:(wave.cells||[]).map(c=>({
      ...c,
      wave_period_s:num(c.wave_mean_period_s)??num(c.wave_peak_period_s)
    }))
  };
}
function waveFrames(){
  const observed=marineWaveFrame();
  const forecast=forecastFramesFor("wave");
  if(!observed)return forecast;
  const observedAt=Date.parse(observed.sampled_time||"");
  const future=forecast.filter(f=>{
    const t=Date.parse(f.valid_time||"");
    return !Number.isFinite(observedAt)||!Number.isFinite(t)||t>observedAt+60*60*1000;
  });
  return [observed,...future];
}
function sceneFrames(scene){
  if(scene==="cloud")return cloudFrames();
  if(scene==="wave")return waveFrames();
  return forecastFramesFor(scene);
}
function sceneAvailable(scene){
  return sceneFrames(scene).length>0;
}
function setTabAvailability(){
  document.querySelectorAll(".tabs button").forEach(b=>{
    b.disabled=!sceneAvailable(b.dataset.scene);
  });
}

function setScene(scene){
  if(!sceneAvailable(scene)) return;
  state.scene=scene;
  document.querySelector(".map-shell").dataset.scene=scene;
  if(state.anchorLayer) state.anchorLayer.setOpacity(.30);
  stop();
  stopSceneParticles();
  document.querySelectorAll(".tabs button").forEach(b=>b.classList.toggle("active",b.dataset.scene===scene));
  state.frames=sceneFrames(scene);

  if(scene==="cloud"){
    state.index=Math.max(0,state.frames.length-1);
  }else if(
    scene==="wave" &&
    state.frames[0]?.data_class==="OBSERVED_MARINE" &&
    (ageMinutes(state.frames[0]?.sampled_time)??Infinity)<=210
  ){
    state.index=0;
  }else{
    let best=0,dist=Infinity;
    state.frames.forEach((f,i)=>{
      const d=Math.abs(Date.parse(f.valid_time||f.sampled_time||"")-Date.now());
      if(d<dist){dist=d;best=i}
    });
    state.index=best;
  }

  $("slider").max=String(Math.max(0,state.frames.length-1));
  $("slider").value=String(state.index);
  seedParticles();
  renderActualStations();
  updateCopy();
  refreshSelectionFlag();
  queueRender();
}
function frame(){return state.frames[state.index]||null}

function pointEntries(){
  return Object.entries(state.compact?.points||{})
    .filter(([id])=>id!=="rach_gia")
    .map(([id,v])=>({id,...v}));
}
function strongestPoint(){
  return pointEntries().sort((a,b)=>(b.score||0)-(a.score||0))[0]||null;
}
function motionTrusted(m){
  // Current V2 centroid/path heuristic is useful for research but not yet a public motion vector.
  if(!m||!m.public_track_usable) return false;
  if(m.method==="HIMAWARI_PATH_INTERSECTION_V2") return false;
  return ["HIGH","VERY_HIGH"].includes(String(m.tracking_confidence||"").toUpperCase());
}
function cloudSummary(){
  const p=strongestPoint();
  if(!p) return {headline:"Mây quanh Phú Quốc",summary:"Chưa đủ dữ liệu vệ tinh để diễn giải.",facts:[]};

  const score=Number(p.score||0);
  const name=NAMES[p.id]||p.id;
  const motion=p.cloud_motion||{};
  let headline,summary;

  if(score<40){
    headline="Chưa thấy đối lưu nổi bật quanh các điểm theo dõi";
    summary="Mây vẫn được hiển thị theo ảnh vệ tinh. Màu mạnh chỉ dành cho đỉnh mây cao/lạnh đáng chú ý.";
  }else if(score<60){
    headline="Mây cao đáng chú ý gần "+name;
    summary="Có tín hiệu mây phát triển, nhưng chưa đủ để suy diễn mưa hoặc sét tại mặt đất.";
  }else{
    headline="Cụm mây đối lưu phát triển rõ gần "+name;
    summary="Đỉnh mây cao/lạnh đang nổi bật trên Himawari. Cần đối chiếu mưa thực tế và các nguồn quan trắc khác.";
  }

  if(motionTrusted(motion)){
    summary+=" Motion quan trắc đủ chuẩn: "+(motion.motion_heading||"đang được theo dõi")+".";
  }else if(score>=40){
    summary+=" Chưa đủ chắc để nói cụm mây đang đi theo hướng nào.";
  }

  const facts=[];
  if(p.cold_cloud_top_temp_c!=null) facts.push("Đỉnh mây "+Math.round(p.cold_cloud_top_temp_c)+"°C");
  if(p.high_cloud_top_height_m!=null) facts.push("≈ "+(p.high_cloud_top_height_m/1000).toFixed(1)+" km");
  if(p.cooling_c_per_20m_proxy!=null&&Math.abs(p.cooling_c_per_20m_proxy)>=3){
    facts.push(p.cooling_c_per_20m_proxy<0?"Đỉnh đang lạnh nhanh":"Đỉnh đang ấm lên");
  }
  return {headline,summary,facts};
}

function rainActualState(){
  const rain=state.current?.groundtruth?.rainfall;
  const stations=Object.values(rain?.stations||{});
  if(!stations.length) return {label:"VRain chưa sẵn sàng",wet:0,known:0,unknown:0};
  const recent=stations.filter(g=>{
    const a=ageMinutes(g.observed_at);
    return a!==null&&a<=45;
  });
  if(!recent.length) return {label:"VRain đang chờ dữ liệu mới",wet:0,known:0,unknown:stations.length};

  let wet=0,known=0,unknown=0;
  for(const g of recent){
    if(g.rain_recently_observed===true){wet++;known++;continue}
    if(g.rain_recently_observed===false && g.increment_qc!=="WINDOW_TOO_OLD_FOR_CURRENT_RAIN"){known++;continue}
    unknown++;
  }
  if(wet>0) return {label:wet+"/"+recent.length+" trạm mới ghi nhận mưa",wet,known,unknown};
  if(known===recent.length) return {label:"Các trạm VRain mới cập nhật chưa ghi nhận mưa",wet,known,unknown};
  return {label:"VRain có dữ liệu nhưng cửa sổ mưa hiện tại chưa đủ ở một số trạm",wet,known,unknown};
}
function maxRainInFrame(f){
  return Math.max(0,...(f?.cells||[]).map(c=>Number(c.rain_mm)||0));
}
function maxWindInFrame(f){
  return Math.max(0,...(f?.cells||[]).map(c=>Number(c.wind_kmh)||0));
}
function maxWaveInFrame(f){
  return Math.max(0,...(f?.cells||[]).map(c=>Number(c.wave_hs_m)||0));
}

function updateCopy(){
  const f=frame();
  let sourceTime=null,kind="forecast";

  if(state.scene==="cloud"){
    const x=cloudSummary();
    $("eyebrow").textContent="QUAN TRẮC VỆ TINH";
    $("headline").textContent=x.headline;
    $("summary").textContent=x.summary;
    $("facts").innerHTML=x.facts.map(v=>"<span>"+v+"</span>").join("");
    $("timeLabel").textContent=stamp(f?.sampled_time);
    $("timeMeta").textContent="JoTrip Weather · Himawari-9 · observed";
    $("modelBadge").textContent="HIMAWARI-9 · OBSERVED";
    $("timeClass").textContent="OBSERVED";
    $("timeClass").className="time-class observed";
    sourceTime=f?.sampled_time||state.nowcast?.sampled_time;
    kind="satellite";
    $("legend").innerHTML=
      '<b>Mây</b>'+
      '<div class="bar" style="background:linear-gradient(90deg,#e6ecef,#d7e7ed,#9ccde1,#66b0d7,#e5d360,#ed8a48,#c44c59)"></div>'+
      '<div class="scale"><span>mây thường</span><span>đỉnh lạnh/cao</span></div>';
  }

  if(state.scene==="rain"){
    const actual=rainActualState();
    const peak=maxRainInFrame(f);
    $("eyebrow").textContent="DỰ BÁO + ĐO THỰC";
    $("headline").textContent=peak<.2?"Mưa dự báo rất ít trong bước này":"Trường mưa ECMWF";
    $("summary").textContent="Màu là mưa dự báo. Các chấm trên bản đồ là trạm VRain đo thực tế và được giữ tách riêng.";
    $("facts").innerHTML=
      "<span>"+actual.label+"</span>"+
      "<span>Đỉnh ô model "+peak.toFixed(1)+" mm</span>";
    $("timeLabel").textContent=stamp(f?.valid_time);
    $("timeMeta").textContent="JoTrip Weather · ECMWF IFS · run "+utcCycleLabel(modelRunIso("rain"));
    $("modelBadge").textContent="ECMWF IFS · RUN "+utcCycleLabel(modelRunIso("rain"));
    $("timeClass").textContent="FORECAST";
    $("timeClass").className="time-class forecast";
    sourceTime=state.ecmwf?.generated_at||f?.valid_time;
    kind="forecast";
    $("legend").innerHTML=
      '<b>Mưa</b>'+
      '<div class="bar" style="background:linear-gradient(90deg,#5aa6d8,#40c1d5,#3cba91,#dbd05a,#ef9940,#d95857,#a84978)"></div>'+
      '<div class="scale"><span>nhẹ</span><span>mạnh</span></div>';
  }

  if(state.scene==="wind"){
    const peak=maxWindInFrame(f);
    $("eyebrow").textContent="DỰ BÁO";
    $("headline").textContent="Gió mặt đất 10 m";
    $("summary").textContent="Các hạt chuyển động cho biết hướng và độ mạnh của gió ở độ cao 10 m. Đây không phải hướng đi của mây.";
    $("facts").innerHTML="<span>Gió mạnh nhất trên khung ≈ "+Math.round(peak)+" km/h</span><span>JoTrip Weather</span>";
    $("timeLabel").textContent=stamp(f?.valid_time);
    $("timeMeta").textContent="JoTrip Weather · ECMWF IFS · run "+utcCycleLabel(modelRunIso("wind"));
    $("modelBadge").textContent="ECMWF IFS · RUN "+utcCycleLabel(modelRunIso("wind"));
    $("timeClass").textContent="FORECAST";
    $("timeClass").className="time-class forecast";
    sourceTime=state.ecmwf?.generated_at||f?.valid_time;
    kind="forecast";
    $("legend").innerHTML='<b>Gió 10 m</b><div class="scale"><span>particle = hướng trường gió</span></div>';
  }

  if(state.scene==="wave"){
    const peak=maxWaveInFrame(f);
    const observed=f?.data_class==="OBSERVED_MARINE";
    $("eyebrow").textContent=observed?"BIỂN GẦN HIỆN TẠI":"DỰ BÁO BIỂN";
    $("headline").textContent="Sóng quanh Phú Quốc";
    $("summary").textContent=observed
      ?"Màu là Hs từ Copernicus Marine gần thời điểm hiện tại. Hướng và chu kỳ được đọc tại điểm chọn."
      :"Màu là Hs dự báo từ ECMWF Wave. Hướng và chu kỳ được đọc tại điểm chọn.";
    $("facts").innerHTML="<span>Hs lớn nhất trên khung ≈ "+peak.toFixed(1)+" m</span><span>"+(observed?"Copernicus Marine":"ECMWF Wave")+"</span>";
    $("timeLabel").textContent=stamp(observed?f?.sampled_time:f?.valid_time);
    $("timeMeta").textContent=observed
      ?"JoTrip Weather · Copernicus Marine · near-now"
      :"JoTrip Weather · ECMWF Wave · run "+utcCycleLabel(modelRunIso("wave"));
    $("modelBadge").textContent=observed?"COPERNICUS · NEAR-NOW":"ECMWF WAVE · RUN "+utcCycleLabel(modelRunIso("wave"));
    $("timeClass").textContent=observed?"NEAR-NOW":"FORECAST";
    $("timeClass").className="time-class "+(observed?"observed":"forecast");
    sourceTime=observed?f?.sampled_time:(state.ecmwf?.generated_at||f?.valid_time);
    kind=observed?"marine":"forecast";
    $("legend").innerHTML=
      '<b>Sóng Hs</b>'+
      '<div class="bar" style="background:linear-gradient(90deg,#e6f6f8,#b8e5e9,#79cdd7,#43aec5,#2b87b5,#2f61a3,#4e4591,#6a3080)"></div>'+
      '<div class="scale"><span>0.2 m</span><span>0.6</span><span>1.0</span><span>1.6+ m</span></div>';
  }

  const fresh=kind==="marine"&&sourceTime
    ? {text:"mốc Copernicus "+stamp(sourceTime)+" · nguồn 3 giờ",stale:(ageMinutes(sourceTime)??Infinity)>210}
    : (state.scene==="cloud"?freshnessText(sourceTime,kind):modelCycleBadge(state.scene));
  $("freshness").textContent=fresh.text;
  $("freshness").classList.toggle("stale",fresh.stale);
  $("slider").value=String(state.index);
  updateSourcePanel();
}

function updateSourcePanel(){
  let title="",text="",meta=[];
  const f=frame();

  if(state.scene==="cloud"){
    title="JoTrip Weather · Himawari cloud";
    text="Observed satellite qua JoTrip Weather. Thân mây dùng median cloud-top để giữ hình khối; lõi lạnh dùng cold cloud-top để nhấn phần phát triển mạnh. Không có icon sét vì lightning feed trực tiếp chưa được nối.";
    meta=[
      "Pipeline: JoTrip Weather",
      "Nguồn gốc: "+(state.nowcast?.source||"JMA Himawari-9 via NOAA Open Data"),
      "Native source: "+(state.nowcast?.observation_resolution||"~2 km ở nadir"),
      "Render grid hiện tại: "+(state.nowcast?.spatial?.display_grid_deg||0.05)+"°",
      "Motion public: tạm khóa cho đến khi feature tracking được xác minh"
    ];
  }else if(state.scene==="rain"){
    title="JoTrip Weather · ECMWF IFS";
    text="Raster màu là forecast field của JoTrip Weather từ ECMWF IFS. Điểm VRain là ACTUAL và vẫn giữ tách biệt.";
    meta=[
      "Model cycle: "+localRunLabel(modelRunIso("rain"))+" ("+utcCycleLabel(modelRunIso("rain"))+")",
      "File build: "+localRunLabel(state.ecmwf?.generated_at),
      "ECMWF source grid: "+(state.ecmwf?.spatial?.requested_grid_deg||0.25)+"°",
      "Interpolation: render only",
      "VRain: "+(state.current?.groundtruth?.rainfall?.status||"không sẵn sàng"),
      "Không tạo chi tiết mưa nhỏ hơn source grid"
    ];
  }else if(state.scene==="wind"){
    title="JoTrip Weather · ECMWF IFS";
    text="Particle dùng forecast field u10/v10 của JoTrip Weather từ ECMWF IFS. Không dùng gió mặt đất để suy diễn cloud motion.";
    meta=[
      "Model cycle: "+localRunLabel(modelRunIso("wind"))+" ("+utcCycleLabel(modelRunIso("wind"))+")",
      "File build: "+localRunLabel(state.ecmwf?.generated_at),
      "Độ cao: 10 m",
      "Source grid: "+(state.ecmwf?.spatial?.requested_grid_deg||0.25)+"°",
      "Data class: JoTrip Weather forecast"
    ];
  }else{
    const observed=f?.data_class==="OBSERVED_MARINE";
    title=observed?"JoTrip Weather · Copernicus Marine":"JoTrip Weather · ECMWF Wave";
    text=observed
      ?"Lớp đầu timeline là trường sóng Copernicus Marine gần hiện tại. Các mốc sau chuyển sang ECMWF Wave và được ghi rõ là dự báo."
      :"Đây là phần dự báo ECMWF Wave sau lớp biển gần hiện tại của Copernicus Marine.";
    meta=observed?[
      "Nguồn: Copernicus Marine",
      "Sampled: "+localRunLabel(f?.sampled_time),
      "Biến: Hs / hướng / chu kỳ",
      "Native grid: "+(state.marine?.wave?.native_resolution_deg?.lat||"-")+"° × "+(state.marine?.wave?.native_resolution_deg?.lon||"-")+"°",
      "Interpolation: render only"
    ]:[
      "Forecast cycle: "+localRunLabel(modelRunIso("wave"))+" ("+utcCycleLabel(modelRunIso("wave"))+")",
      "Forecast build: "+localRunLabel(state.ecmwf?.generated_at),
      "Biến: Hs / hướng / chu kỳ",
      "Source grid: "+(state.ecmwf?.spatial?.requested_grid_deg||0.25)+"°",
      "Data class: forecast"
    ];
  }

  if(state.probe&&f){
    const nearest=nearestCell(f.cells||[],state.probe.lat,state.probe.lon);
    if(nearest){
      if(state.scene==="cloud"&&nearest.cloud_top_cold_c!=null){
        meta.push("Điểm chạm gần nhất: "+Number(nearest.cloud_top_cold_c).toFixed(1)+"°C cloud top");
      }
      if(state.scene==="rain"&&nearest.rain_mm!=null){
        meta.push("Điểm chạm gần nhất: "+Number(nearest.rain_mm).toFixed(2)+" mm / bước model");
      }
      if(state.scene==="wind"&&nearest.wind_kmh!=null){
        meta.push("Điểm chạm gần nhất: "+Math.round(Number(nearest.wind_kmh))+" km/h");
      }
      if(state.scene==="wave"&&nearest.wave_hs_m!=null){
        meta.push("Điểm chạm gần nhất: Hs "+Number(nearest.wave_hs_m).toFixed(2)+" m");
        if(nearest.wave_period_s!=null) meta.push("Chu kỳ "+Number(nearest.wave_period_s).toFixed(1)+" s");
        if(nearest.wave_direction_deg!=null) meta.push("Hướng sóng "+Math.round(Number(nearest.wave_direction_deg))+"°");
      }
    }
  }

  $("sourceTitle").textContent=title;
  $("sourceText").textContent=text;
  $("sourceMeta").innerHTML=meta.map(x=>"<span>"+x+"</span>").join("");
}

function grid(rows,key){
  const valid=(rows||[]).map(r=>({
    lat:num(r.lat),lon:num(r.lon),
    v:num(typeof key==="function"?key(r):r[key])
  })).filter(r=>r.lat!==null&&r.lon!==null&&r.v!==null);
  if(!valid.length) return null;

  const lats=[...new Set(valid.map(r=>r.lat))].sort((a,b)=>a-b);
  const lons=[...new Set(valid.map(r=>r.lon))].sort((a,b)=>a-b);
  if(lats.length<2||lons.length<2) return null;

  const values=new Map(valid.map(r=>[r.lat.toFixed(5)+"|"+r.lon.toFixed(5),r.v]));
  return {
    lats,lons,values,
    dLat:(lats.at(-1)-lats[0])/(lats.length-1),
    dLon:(lons.at(-1)-lons[0])/(lons.length-1),
    lat0:lats[0],lat1:lats.at(-1),lon0:lons[0],lon1:lons.at(-1)
  };
}
function sampleGrid(g,lat,lon){
  if(!g||lat<g.lat0||lat>g.lat1||lon<g.lon0||lon>g.lon1) return null;
  const fy=(lat-g.lat0)/g.dLat,fx=(lon-g.lon0)/g.dLon;
  const y0=clamp(Math.floor(fy),0,g.lats.length-2),x0=clamp(Math.floor(fx),0,g.lons.length-2);
  const y1=y0+1,x1=x0+1,ty=clamp(fy-y0,0,1),tx=clamp(fx-x0,0,1);
  const get=(y,x)=>g.values.get(g.lats[y].toFixed(5)+"|"+g.lons[x].toFixed(5));
  const q=[
    [get(y0,x0),(1-tx)*(1-ty)],
    [get(y0,x1),tx*(1-ty)],
    [get(y1,x0),(1-tx)*ty],
    [get(y1,x1),tx*ty]
  ];
  let sw=0,sv=0;
  for(const [v,w] of q){
    if(Number.isFinite(v)){sw+=w;sv+=v*w}
  }
  return sw?sv/sw:null;
}
function nearestCell(rows,lat,lon){
  let best=null,dist=Infinity;
  for(const r of rows||[]){
    const d=(Number(r.lat)-lat)**2+(Number(r.lon)-lon)**2;
    if(d<dist){dist=d;best=r}
  }
  return best;
}
function nearestValidCell(rows,lat,lon,predicate){
  let best=null,dist=Infinity;
  for(const r of rows||[]){
    if(predicate&&!predicate(r)) continue;
    const rlat=Number(r.lat),rlon=Number(r.lon);
    if(!Number.isFinite(rlat)||!Number.isFinite(rlon)) continue;
    const d=(rlat-lat)**2+(rlon-lon)**2;
    if(d<dist){dist=d;best=r}
  }
  return best;
}
function ramp(stops,t){
  t=clamp(t,0,1);
  for(let i=1;i<stops.length;i++){
    if(t<=stops[i][0]){
      const a=stops[i-1],b=stops[i],q=(t-a[0])/Math.max(.0001,b[0]-a[0]);
      return a[1].map((v,k)=>Math.round(v+(b[1][k]-v)*q));
    }
  }
  return stops.at(-1)[1];
}
function between(v,a,b){return clamp((v-a)/(b-a),0,1)}

function cloudBodyStyle(c){
  if(c===null||c>8) return [0,0,0,0];
  if(c>-8){
    const t=between(c,8,-8);
    const rgb=ramp([[0,[224,230,232]],[1,[242,246,247]]],t);
    return [...rgb,Math.round((.04+t*.10)*255)];
  }
  if(c>-18){
    const t=between(c,-8,-18);
    const rgb=ramp([[0,[242,246,247]],[1,[229,239,243]]],t);
    return [...rgb,Math.round((.14+t*.12)*255)];
  }
  if(c>-28){
    const t=between(c,-18,-28);
    const rgb=ramp([[0,[229,239,243]],[1,[186,220,233]]],t);
    return [...rgb,Math.round((.26+t*.10)*255)];
  }
  const t=between(c,-28,-45);
  const rgb=ramp([[0,[186,220,233]],[1,[151,202,224]]],t);
  return [...rgb,Math.round((.36+t*.08)*255)];
}
function cloudCoreStyle(c){
  if(c===null||c>-38) return [0,0,0,0];
  if(c>-48){
    const t=between(c,-38,-48);
    const rgb=ramp([[0,[113,191,222]],[1,[94,170,215]]],t);
    return [...rgb,Math.round((.18+t*.20)*255)];
  }
  if(c>-58){
    const t=between(c,-48,-58);
    const rgb=ramp([[0,[94,170,215]],[1,[229,211,92]]],t);
    return [...rgb,Math.round((.38+t*.16)*255)];
  }
  if(c>-68){
    const t=between(c,-58,-68);
    const rgb=ramp([[0,[229,211,92]],[1,[238,137,68]]],t);
    return [...rgb,Math.round((.54+t*.12)*255)];
  }
  const t=between(c,-68,-82);
  const rgb=ramp([[0,[238,137,68]],[1,[190,66,82]]],t);
  return [...rgb,Math.round((.66+t*.10)*255)];
}
function alphaOver(base,top){
  const ba=(base[3]||0)/255,ta=(top[3]||0)/255;
  const oa=ta+ba*(1-ta);
  if(oa<=0) return [0,0,0,0];
  return [
    Math.round((top[0]*ta+base[0]*ba*(1-ta))/oa),
    Math.round((top[1]*ta+base[1]*ba*(1-ta))/oa),
    Math.round((top[2]*ta+base[2]*ba*(1-ta))/oa),
    Math.round(oa*255)
  ];
}
function rainStyle(mm){
  if(mm===null||mm<.10) return [0,0,0,0];
  const t=clamp(Math.log1p(mm)/Math.log(41),0,1);
  const rgb=ramp([
    [0,[90,166,216]],[.25,[64,193,213]],[.45,[60,186,145]],
    [.65,[219,208,90]],[.82,[239,153,64]],[.93,[217,88,87]],[1,[168,73,120]]
  ],t);
  const alpha=.08+Math.pow(t,.72)*.68;
  return [...rgb,Math.round(alpha*255)];
}
function waveStyle(hs){
  if(hs===null||hs<.05) return [0,0,0,0];
  const t=clamp(hs/1.6,0,1);
  const rgb=ramp([
    [0,[226,244,247]],[.15,[170,222,229]],[.30,[105,194,208]],
    [.48,[61,158,187]],[.66,[48,113,170]],[.84,[76,79,149]],[1,[103,50,133]]
  ],t);
  return [...rgb,Math.round((.14+.60*Math.pow(t,.68))*255)];
}
function sizeCanvas(c){
  const r=$("map").getBoundingClientRect();
  const scale=innerWidth<760?.58:.50;
  const w=Math.max(180,Math.round(r.width*scale)),h=Math.max(220,Math.round(r.height*scale));
  if(c.width!==w||c.height!==h){
    c.width=w;c.height=h;
    c.style.width=r.width+"px";c.style.height=r.height+"px";
  }
  return {w,h,scale};
}
function renderScalar(){
  const c=$("fieldCanvas"),m=$("motionCanvas");
  if(window.JoTripSceneRenderer){
    const f=frame();
    window.JoTripSceneRenderer.render({
      scene:state.scene,
      rows:f?.cells||[],
      map:state.map,
      fieldCanvas:c,
      motionCanvas:m
    });
    return;
  }
  const {w,h,scale}=sizeCanvas(c);
  sizeCanvas(m);
  const ctx=c.getContext("2d"),mctx=m.getContext("2d");
  ctx.clearRect(0,0,w,h);
  mctx.clearRect(0,0,w,h);

  const f=frame();
  if(!f) return;

  if(state.scene==="wind"){
    drawParticles(mctx,w,h,scale);
    return;
  }

  const rows=f.cells||[];
  const bodyGrid=state.scene==="cloud"?grid(rows,"cloud_top_median_c"):null;
  const coreGrid=state.scene==="cloud"?grid(rows,"cloud_top_cold_c"):null;
  const g=state.scene==="rain"?grid(rows,"rain_mm"):state.scene==="wave"?grid(rows,"wave_hs_m"):null;
  if(state.scene==="cloud" && (!bodyGrid||!coreGrid)) return;
  if(state.scene!=="cloud" && !g) return;

  const img=ctx.createImageData(w,h);
  const west=state.map.containerPointToLatLng([0,0]).lng;
  const east=state.map.containerPointToLatLng([w/scale,0]).lng;

  for(let y=0;y<h;y++){
    const lat=state.map.containerPointToLatLng([0,y/scale]).lat;
    for(let x=0;x<w;x++){
      const lon=west+(east-west)*(x/(w-1));
      let col;
      if(state.scene==="cloud"){
        const body=cloudBodyStyle(sampleGrid(bodyGrid,lat,lon));
        const core=cloudCoreStyle(sampleGrid(coreGrid,lat,lon));
        col=alphaOver(body,core);
      }else{
        const v=sampleGrid(g,lat,lon);
        col=state.scene==="rain"?rainStyle(v):waveStyle(v);
      }
      const k=(y*w+x)*4;
      img.data[k]=col[0];img.data[k+1]=col[1];img.data[k+2]=col[2];img.data[k+3]=col[3];
    }
  }
  ctx.putImageData(img,0,0);

  if(state.scene==="cloud") drawFutureMotionIfTrusted(mctx,scale);
}
function drawFutureMotionIfTrusted(ctx,scale){
  const candidate=pointEntries()
    .filter(p=>motionTrusted(p.cloud_motion))
    .sort((a,b)=>(b.score||0)-(a.score||0))[0];
  if(!candidate) return;

  const m=candidate.cloud_motion;
  const p=state.map.latLngToContainerPoint([m.cloud_center_lat,m.cloud_center_lon]);
  const x=p.x*scale,y=p.y*scale;
  if(x<0||y<0||x>ctx.canvas.width||y>ctx.canvas.height) return;

  const ang=((m.motion_heading_deg||0)-90)*Math.PI/180;
  const len=22*scale;
  ctx.save();
  ctx.strokeStyle="rgba(27,58,68,.42)";
  ctx.lineWidth=Math.max(.8,1.1*scale);
  ctx.beginPath();
  ctx.moveTo(x,y);
  ctx.lineTo(x+Math.cos(ang)*len,y+Math.sin(ang)*len);
  ctx.stroke();
  ctx.restore();
}

function seedParticles(){
  state.particles=[];
  if(state.scene!=="wind") return;
  const n=innerWidth<760?90:165;
  for(let i=0;i<n;i++){
    state.particles.push({x:Math.random(),y:Math.random(),age:Math.random()*85});
  }
}
function windGrids(){
  const f=frame();
  return {u:grid(f?.cells||[],"u10_ms"),v:grid(f?.cells||[],"v10_ms")};
}
function drawParticles(ctx,w,h,scale){
  ctx.clearRect(0,0,w,h);
  const gs=windGrids();
  if(!gs.u||!gs.v) return;

  ctx.strokeStyle="rgba(18,62,72,.29)";
  ctx.lineWidth=Math.max(.55,.82*scale);

  for(const p of state.particles){
    const sx=p.x*w,sy=p.y*h;
    const ll=state.map.containerPointToLatLng([sx/scale,sy/scale]);
    const u=sampleGrid(gs.u,ll.lat,ll.lng),v=sampleGrid(gs.v,ll.lat,ll.lng);
    if(u===null||v===null){
      p.x=Math.random();p.y=Math.random();p.age=0;continue;
    }

    const ox=p.x,oy=p.y;
    p.x+=u*.00086;
    p.y-=v*.00086;
    p.age+=1;

    if(p.x<0||p.x>1||p.y<0||p.y>1||p.age>92){
      p.x=Math.random();p.y=Math.random();p.age=0;continue;
    }

    ctx.beginPath();
    ctx.moveTo(ox*w,oy*h);
    ctx.lineTo(p.x*w,p.y*h);
    ctx.stroke();
  }

  state.raf=requestAnimationFrame(renderScalar);
}

function nearestLocalPoint(lat,lon){
  const points=Object.entries(state.current?.local_now?.points||{})
    .filter(([id])=>id!=="rach_gia")
    .map(([,p])=>p);
  let best=null,dist=Infinity;
  for(const p of points){
    if(p.lat==null||p.lon==null) continue;
    const d=(Number(p.lat)-lat)**2+(Number(p.lon)-lon)**2;
    if(d<dist){dist=d;best=p}
  }
  return best&&dist<=0.14**2?best:null;
}
function localCurrentState(){
  const iso=state.current?.local_now?.generated_at||state.current?.generated_at||null;
  const age=ageMinutes(iso);
  return {
    iso,
    fresh:age!==null&&age<=45,
    label:age!==null&&age<=45?"JoTrip hiện tại":"JoTrip gần nhất"
  };
}
function selectionHtml(lat,lon){
  const f=frame();
  const cells=f?.cells||[];
  const cell=state.scene==="wave"
    ? nearestValidCell(cells,lat,lon,r=>num(r.wave_hs_m)!==null)
    : state.scene==="rain"
      ? nearestValidCell(cells,lat,lon,r=>num(r.rain_mm)!==null)
      : state.scene==="wind"
        ? nearestValidCell(cells,lat,lon,r=>num(r.wind_kmh)!==null||(num(r.u10_ms)!==null&&num(r.v10_ms)!==null))
        : nearestCell(cells,lat,lon);
  const local=nearestLocalPoint(lat,lon);
  const localState=localCurrentState();
  let localRendered=false;
  const frameIso=f?.sampled_time||f?.valid_time||null;
  const rows=['<div class="selection-title">Điểm chọn</div>'];
  if(frameIso) rows.push('<span class="selection-frame">Frame '+stamp(frameIso)+'</span>');

  if(state.scene==="cloud"){
    if(cell?.cloud_top_cold_c!=null) rows.push('<b>JoTrip Cloud:</b> '+Number(cell.cloud_top_cold_c).toFixed(1)+'°C đỉnh mây');
    if(cell?.cloud_top_high_m!=null) rows.push('Đỉnh cao ≈ '+(Number(cell.cloud_top_high_m)/1000).toFixed(1)+' km');
    if(cell?.convective_level) rows.push('Đối lưu: '+cell.convective_level);
  }else if(state.scene==="rain"){
    if(local?.rain?.rain_rate_mm_h!=null){ rows.push('<b>'+localState.label+':</b> '+Number(local.rain.rain_rate_mm_h).toFixed(2)+' mm/h'); localRendered=true; }
    if(cell?.rain_mm!=null) rows.push('<b>JoTrip Forecast:</b> '+Number(cell.rain_mm).toFixed(2)+' mm / bước');
  }else if(state.scene==="wind"){
    if(local?.wind_kmh!=null){ rows.push('<b>'+localState.label+':</b> '+Number(local.wind_kmh).toFixed(1)+' km/h'); localRendered=true; }
    if(cell?.wind_kmh!=null) rows.push('<b>JoTrip Forecast:</b> '+Number(cell.wind_kmh).toFixed(1)+' km/h');
  }else if(state.scene==="wave"){
    if(local?.wave_hs_m!=null){ rows.push('<b>'+localState.label+':</b> Hs '+Number(local.wave_hs_m).toFixed(2)+' m'); localRendered=true; }
    if(local?.wave_period_s!=null) rows.push('Chu kỳ gần nhất '+Number(local.wave_period_s).toFixed(1)+' s');
    if(cell?.wave_hs_m!=null) rows.push('<b>'+(f?.data_class==="OBSERVED_MARINE"?"Copernicus gần hiện tại":"Dự báo ô biển gần nhất")+':</b> Hs '+Number(cell.wave_hs_m).toFixed(2)+' m');
    if(cell?.wave_period_s!=null) rows.push('Chu kỳ '+Number(cell.wave_period_s).toFixed(1)+' s');
    if(cell?.wave_direction_deg!=null){
      const from=Math.round(Number(cell.wave_direction_deg))%360;
      const to=(from+180)%360;
      rows.push('Sóng đến từ '+from+'° · đi về '+to+'°');
    }
    if(cell?.wave_hs_m==null) rows.push('<span class="selection-near">Chưa có ô dự báo biển hợp lệ tại vùng này.</span>');
  }

  if(localRendered&&localState.iso&&!localState.fresh) rows.push('<span class="selection-near">Số gần nhất cập nhật '+stamp(localState.iso)+'</span>');
  if(local?.name) rows.push('<span class="selection-near">Điểm JoTrip gần nhất: '+local.name+'</span>');
  rows.push('<span class="selection-coord">'+lat.toFixed(4)+', '+lon.toFixed(4)+'</span>');
  return rows.join('<br>');
}
function placeSelectionFlag(lat,lon){
  if(!probeAllowed(lat,lon))return;
  if(state.selectedMarker){
    state.map.removeLayer(state.selectedMarker);
    state.selectedMarker=null;
  }
  const icon=L.divIcon({
    className:"selection-flag-wrap",
    html:'<div class="selection-flag"><span class="flag-cloth"></span><span class="flag-pole"></span><span class="flag-dot"></span></div>',
    iconSize:[28,38],
    iconAnchor:[6,35],
    popupAnchor:[8,-30]
  });
  state.selectedMarker=L.marker([lat,lon],{icon,pane:"sceneLabels",zIndexOffset:1200})
    .bindPopup(selectionHtml(lat,lon),{
      className:"selection-popup",
      closeButton:true,
      offset:[0,-2],
      autoPan:true,
      maxWidth:230
    })
    .addTo(state.map);
  state.selectedMarker.on("popupopen",()=>document.querySelector(".map-shell")?.classList.add("has-selection"));
  state.selectedMarker.on("popupclose",()=>document.querySelector(".map-shell")?.classList.remove("has-selection"));
  state.selectedMarker.openPopup();
}
function refreshSelectionFlag(){
  if(!state.selectedMarker||!state.probe) return;
  state.selectedMarker.setPopupContent(selectionHtml(state.probe.lat,state.probe.lon));
  if(state.selectedMarker.isPopupOpen()) state.selectedMarker.openPopup();
}

function renderActualStations(){
  if(!state.actualLayer) return;
  state.actualLayer.clearLayers();
  if(state.scene!=="rain") return;

  const stations=Object.values(state.current?.groundtruth?.rainfall?.stations||{});
  for(const g of stations){
    const a=ageMinutes(g.observed_at);
    if(a===null||a>45) continue;
    const wet=g.rain_recently_observed===true;
    const currentWindow=g.increment_qc!=="WINDOW_TOO_OLD_FOR_CURRENT_RAIN";
    const stateLabel=wet?"Có mưa gần đây":currentWindow&&g.rain_recently_observed===false?"Chưa ghi nhận mưa gần đây":"Cửa sổ hiện tại chưa đủ";
    const marker=L.circleMarker([g.lat,g.lon],{
      radius:wet?6:5,
      color:wet?"#ffffff":"#285a67",
      weight:2,
      fillColor:wet?"#2d8297":"#ffffff",
      fillOpacity:.96,
      pane:"sceneLabels"
    });
    marker.bindTooltip(
      "<b>"+g.station_name+"</b><br>"+stateLabel+
      (g.accumulation_mm!=null?"<br>Tích lũy kỳ: "+Number(g.accumulation_mm).toFixed(1)+" mm":""),
      {className:"scene-tip",direction:"top",opacity:.96}
    );
    marker.addTo(state.actualLayer);
  }
}

function sceneCanvasSize(c,scale=.44){
  const r=c.getBoundingClientRect();
  const w=Math.max(180,Math.round(r.width*scale));
  const h=Math.max(220,Math.round(r.height*scale));
  c.width=w;c.height=h;
  c.style.width=r.width+"px";c.style.height=r.height+"px";
  return {w,h,sx:w/Math.max(1,r.width),sy:h/Math.max(1,r.height)};
}
function medianScene(values){
  const a=values.filter(Number.isFinite).sort((x,y)=>x-y);
  if(!a.length)return 0;
  const m=Math.floor(a.length/2);
  return a.length%2?a[m]:(a[m-1]+a[m])/2;
}
function projectedRows(rows,c,scale=.44){
  const s=sceneCanvasSize(c,scale);
  const pts=(rows||[]).map(r=>{
    const p=state.map.latLngToContainerPoint([Number(r.lat),Number(r.lon)]);
    return {...r,x:p.x*s.sx,y:p.y*s.sy};
  }).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));
  return {pts,...s};
}
function projectedSpacing(pts){
  if(pts.length<3)return 28;
  const ds=[];
  for(let i=0;i<pts.length;i++){
    let best=Infinity;
    for(let j=0;j<pts.length;j++){
      if(i===j)continue;
      const dx=pts[i].x-pts[j].x,dy=pts[i].y-pts[j].y;
      best=Math.min(best,Math.hypot(dx,dy));
    }
    if(Number.isFinite(best))ds.push(best);
  }
  return clamp(medianScene(ds),10,80);
}
function cloudCoreRgb(cold){
  const t=clamp((-cold-38)/38,0,1);
  return ramp([
    [0,[99,184,221]],[.28,[72,174,215]],[.50,[86,199,163]],
    [.68,[226,211,89]],[.84,[238,142,70]],[1,[191,67,84]]
  ],t);
}
function drawCloudProjected(rows){
  const c=$("fieldCanvas"),ctx=c.getContext("2d"),{pts}=projectedRows(rows,c,innerWidth<760?.52:.44);
  ctx.clearRect(0,0,c.width,c.height);
  if(!pts.length)return;
  const spacing=projectedSpacing(pts),radius=clamp(spacing*1.38,18,72);

  ctx.save();
  for(const p of pts){
    const med=num(p.cloud_top_median_c),cold=num(p.cloud_top_cold_c),high=num(p.cloud_top_high_m);
    if(med===null&&cold===null&&high===null)continue;

    const presence=clamp(
      .08+
      (med===null?0:clamp((-med-2)/42,0,1)*.38)+
      (high===null?0:clamp((high-1800)/10000,0,1)*.34),
      0,.72
    );

    if(presence>.10){
      const cool=med===null?0:clamp((-med-12)/32,0,1);
      const rgb=ramp([[0,[231,237,240]],[1,[176,214,230]]],cool);
      const a=clamp(.09+presence*.34,.09,.34);
      const r=radius*(.92+presence*.36);
      const g=ctx.createRadialGradient(p.x,p.y,r*.08,p.x,p.y,r);
      g.addColorStop(0,"rgba("+rgb[0]+","+rgb[1]+","+rgb[2]+","+a.toFixed(3)+")");
      g.addColorStop(.55,"rgba("+rgb[0]+","+rgb[1]+","+rgb[2]+","+(a*.72).toFixed(3)+")");
      g.addColorStop(1,"rgba("+rgb[0]+","+rgb[1]+","+rgb[2]+",0)");
      ctx.fillStyle=g;ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.fill();
    }

    if(cold!==null&&cold<=-38){
      const rgb=cloudCoreRgb(cold),t=clamp((-cold-38)/38,0,1);
      const a=.22+t*.50,r=radius*(.46+t*.28);
      const g=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,r);
      g.addColorStop(0,"rgba("+rgb[0]+","+rgb[1]+","+rgb[2]+","+a.toFixed(3)+")");
      g.addColorStop(.45,"rgba("+rgb[0]+","+rgb[1]+","+rgb[2]+","+(a*.72).toFixed(3)+")");
      g.addColorStop(1,"rgba("+rgb[0]+","+rgb[1]+","+rgb[2]+",0)");
      ctx.fillStyle=g;ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.fill();
    }
  }
  ctx.restore();
}
function drawRainProjected(rows){
  const c=$("fieldCanvas"),ctx=c.getContext("2d"),{pts}=projectedRows(rows,c,innerWidth<760?.58:.50);
  ctx.clearRect(0,0,c.width,c.height);
  const wet=pts.filter(p=>num(p.rain_mm)!==null&&num(p.rain_mm)>=.05);
  if(!wet.length)return;
  const radius=clamp(projectedSpacing(wet)*1.45,18,78);
  ctx.save();
  for(const p of wet){
    const mm=num(p.rain_mm)||0,t=clamp(Math.log1p(mm)/Math.log(31),0,1);
    const rgba=rainStyle(mm),a=clamp(.18+t*.62,.18,.80),r=radius*(.92+t*.42);
    const g=ctx.createRadialGradient(p.x,p.y,r*.05,p.x,p.y,r);
    g.addColorStop(0,"rgba("+rgba[0]+","+rgba[1]+","+rgba[2]+","+a.toFixed(3)+")");
    g.addColorStop(.50,"rgba("+rgba[0]+","+rgba[1]+","+rgba[2]+","+(a*.70).toFixed(3)+")");
    g.addColorStop(1,"rgba("+rgba[0]+","+rgba[1]+","+rgba[2]+",0)");
    ctx.fillStyle=g;ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.fill();
  }
  ctx.restore();
}
function drawWaveProjected(rows){
  const c=$("fieldCanvas"),ctx=c.getContext("2d"),{pts}=projectedRows(rows,c,innerWidth<760?.54:.46);
  ctx.clearRect(0,0,c.width,c.height);
  const sea=pts.filter(p=>num(p.wave_hs_m)!==null);
  if(!sea.length)return;
  const radius=clamp(projectedSpacing(sea)*1.28,16,66);
  ctx.save();
  sea.forEach((p,i)=>{
    const hs=num(p.wave_hs_m)||0,t=clamp(hs/2.2,0,1),col=waveStyle(hs);
    const a=.10+t*.42,r=radius*(.86+t*.30);
    const g=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,r);
    g.addColorStop(0,"rgba("+col[0]+","+col[1]+","+col[2]+","+a.toFixed(3)+")");
    g.addColorStop(1,"rgba("+col[0]+","+col[1]+","+col[2]+",0)");
    ctx.fillStyle=g;ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.fill();

    const deg=num(p.wave_direction_deg);
    if(deg!==null&&i%2===0){
      const ang=(deg-90)*Math.PI/180,len=5+t*6;
      ctx.strokeStyle="rgba(20,67,91,"+(.28+t*.34).toFixed(3)+")";
      ctx.lineWidth=.8;ctx.beginPath();
      ctx.moveTo(p.x-Math.cos(ang)*len*.35,p.y-Math.sin(ang)*len*.35);
      ctx.lineTo(p.x+Math.cos(ang)*len*.65,p.y+Math.sin(ang)*len*.65);
      ctx.stroke();
    }
  });
  ctx.restore();
}
function projectWindVectors(rows,c){
  const {pts}=projectedRows(rows,c,innerWidth<760?.58:.50);
  return pts.map(p=>({
    x:p.x,y:p.y,u:num(p.u10_ms),v:num(p.v10_ms),mag:Math.hypot(num(p.u10_ms)||0,num(p.v10_ms)||0)
  })).filter(p=>p.u!==null&&p.v!==null);
}
function vectorAt(x,y,pv){
  if(!pv.length)return null;
  const nearest=[];
  for(const p of pv){
    const d2=(x-p.x)*(x-p.x)+(y-p.y)*(y-p.y)+10;
    let k=0;
    while(k<nearest.length&&nearest[k].d2<d2)k++;
    nearest.splice(k,0,{p,d2});
    if(nearest.length>4)nearest.pop();
  }
  let sw=0,u=0,v=0,mag=0;
  for(const n of nearest){
    const w=1/n.d2;sw+=w;u+=n.p.u*w;v+=n.p.v*w;mag+=n.p.mag*w;
  }
  return sw?{u:u/sw,v:v/sw,mag:mag/sw}:null;
}
function drawWindTexture(rows){
  const c=$("fieldCanvas"),ctx=c.getContext("2d");
  sceneCanvasSize(c,innerWidth<760?.58:.50);
  ctx.clearRect(0,0,c.width,c.height);
  const pv=projectWindVectors(rows,c);
  if(!pv.length)return pv;
  ctx.save();ctx.lineCap="round";
  for(let y=8;y<c.height;y+=15){
    for(let x=8;x<c.width;x+=15){
      const n=vectorAt(x,y,pv);if(!n)continue;
      const m=Math.max(.001,Math.hypot(n.u,n.v)),ux=n.u/m,uy=-n.v/m;
      const strength=clamp(n.mag/10,0,1),len=5+strength*6;
      ctx.strokeStyle="rgba(17,70,92,"+(.18+strength*.30).toFixed(3)+")";
      ctx.lineWidth=.65+strength*.45;
      ctx.beginPath();ctx.moveTo(x-ux*len*.4,y-uy*len*.4);ctx.lineTo(x+ux*len*.6,y+uy*len*.6);ctx.stroke();
    }
  }
  ctx.restore();
  return pv;
}
function stopSceneParticles(){
  if(state.particleRaf)cancelAnimationFrame(state.particleRaf);
  state.particleRaf=null;
  const c=$("motionCanvas");
  if(c){const ctx=c.getContext("2d");ctx.clearRect(0,0,c.width,c.height);}
}
function startSceneParticles(rows){
  stopSceneParticles();
  const c=$("motionCanvas"),ctx=c.getContext("2d");
  sceneCanvasSize(c,innerWidth<760?.58:.50);
  const pv=projectWindVectors(rows,c);
  if(!pv.length)return;
  const count=innerWidth<760?95:180;
  state.particles=Array.from({length:count},()=>({x:Math.random()*c.width,y:Math.random()*c.height,age:Math.random()*80}));
  const tick=()=>{
    ctx.clearRect(0,0,c.width,c.height);
    ctx.lineCap="round";
    for(const p of state.particles){
      const n=vectorAt(p.x,p.y,pv);
      if(!n){p.x=Math.random()*c.width;p.y=Math.random()*c.height;continue;}
      const m=Math.max(.001,Math.hypot(n.u,n.v)),ux=n.u/m,uy=-n.v/m;
      const speed=.55+clamp(n.mag/8,0,1)*1.7;
      const ox=p.x,oy=p.y;
      p.x+=ux*speed;p.y+=uy*speed;p.age+=1;
      if(p.x<0||p.y<0||p.x>c.width||p.y>c.height||p.age>110){
        p.x=Math.random()*c.width;p.y=Math.random()*c.height;p.age=0;continue;
      }
      ctx.strokeStyle="rgba(17,70,92,"+(.30+clamp(n.mag/12,0,1)*.38).toFixed(3)+")";
      ctx.lineWidth=.9;ctx.beginPath();ctx.moveTo(ox,oy);ctx.lineTo(p.x,p.y);ctx.stroke();
    }
    state.particleRaf=requestAnimationFrame(tick);
  };
  tick();
}
function renderScalar(){
  const c=$("fieldCanvas"),m=$("motionCanvas");
  const f=frame();
  if(!f)return;
  if(!window.JoTripSceneRenderer){
    throw new Error("Active JoTrip Scene renderer is not loaded");
  }
  window.JoTripSceneRenderer.render({
    scene:state.scene,
    rows:f.cells||[],
    map:state.map,
    fieldCanvas:c,
    motionCanvas:m
  });
}

function queueRender(){
  if(state.raf) cancelAnimationFrame(state.raf);
  state.raf=requestAnimationFrame(renderScalar);
}
function play(){
  if(state.playing){stop();return}
  state.playing=true;
  $("playBtn").textContent="❚❚";
  const delay=state.scene==="cloud"?950:state.scene==="wave"?1700:1250;
  state.timer=setInterval(()=>{
    state.index=(state.index+1)%Math.max(1,state.frames.length);
    $("slider").value=String(state.index);
    updateCopy();
    refreshSelectionFlag();
    seedParticles();
    queueRender();
  },delay);
}
function stop(){
  state.playing=false;
  $("playBtn").textContent="▶";
  if(state.timer) clearInterval(state.timer);
  state.timer=null;
}

function setSourcePanel(open){
  const panel=$("sourcePanel");
  if(!panel)return;
  panel.hidden=!open;
  $("infoBtn")?.setAttribute("aria-expanded",String(open));
  if(open)updateSourcePanel();
}
function setStatusPanel(open){
  const panel=$("statusCard"),restore=$("statusOpenBtn");
  if(panel)panel.hidden=!open;
  if(restore)restore.hidden=open;
}
function bind(){
  document.querySelectorAll(".tabs button").forEach(b=>{
    b.addEventListener("click",()=>setScene(b.dataset.scene));
  });
  $("slider").addEventListener("input",e=>{
    stop();
    state.index=Number(e.target.value)||0;
    updateCopy();
    refreshSelectionFlag();
    seedParticles();
    queueRender();
  });
  $("playBtn").addEventListener("click",play);
  $("infoBtn").addEventListener("click",()=>setSourcePanel($("sourcePanel")?.hidden!==false));
  $("sourceCloseBtn")?.addEventListener("click",()=>setSourcePanel(false));
  $("statusOpenBtn")?.addEventListener("click",()=>setStatusPanel(true));
  document.querySelectorAll("[data-close-panel]").forEach(btn=>{
    btn.addEventListener("click",()=>{
      if(btn.dataset.closePanel==="statusCard")setStatusPanel(false);
      else{
        const panel=$(btn.dataset.closePanel);
        if(panel)panel.hidden=true;
      }
    });
  });
  document.addEventListener("click",e=>{
    const panel=$("sourcePanel"),button=$("infoBtn");
    if(!panel||panel.hidden)return;
    if(panel.contains(e.target)||button?.contains(e.target))return;
    setSourcePanel(false);
  });
  document.addEventListener("keydown",e=>{
    if(e.key!=="Escape")return;
    const source=$("sourcePanel");
    if(source&&!source.hidden){setSourcePanel(false);return}
    if(state.selectedMarker?.isPopupOpen?.()){state.selectedMarker.closePopup();return}
    const status=$("statusCard");
    if(status&&!status.hidden)setStatusPanel(false);
  });
  addEventListener("resize",queueRender,{passive:true});
}

function enforceSceneFreshness(){
  // A static browser tab must never keep painting old near-now fields after they expire.
  const active=frame();
  const cloudExpired=state.scene==="cloud"&&!sceneAvailable("cloud");
  const waveExpired=state.scene==="wave"&&active?.data_class==="OBSERVED_MARINE"&&!marineWaveFrame();
  const forecastExpired=!sceneAvailable(state.scene);
  if(!cloudExpired&&!waveExpired&&!forecastExpired){setTabAvailability();return}
  setTabAvailability();
  const next=cloudExpired
    ?(["rain","wind","wave"].find(s=>sceneAvailable(s))||null)
    :(waveExpired&&sceneAvailable("wave")?"wave":(["rain","wind","wave","cloud"].find(s=>sceneAvailable(s))||null));
  if(next){
    setScene(next);
    const reason=cloudExpired?"Ảnh Himawari đã quá hạn - tạm chuyển sang dự báo, không dùng mây cũ.":waveExpired?"Mốc sóng quan trắc đã quá hạn - chuyển sang dự báo ECMWF Wave.":"Trường dự báo đang xem đã hết hạn - chỉ hiển thị nguồn còn hiệu lực.";
    $("freshness").textContent=reason;
    $("freshness").classList.add("stale");
  }else{
    stop();stopSceneParticles();state.frames=[];state.index=0;
    for(const id of ["fieldCanvas","motionCanvas"]){const canvas=$(id);if(canvas)canvas.getContext("2d")?.clearRect(0,0,canvas.width,canvas.height)}
    $("freshness").textContent="Dữ liệu bản đồ quá hạn - đang chờ nguồn mới.";
    $("freshness").classList.add("stale");
    $("headline").textContent="Chưa có bản đồ đủ mới";
    $("summary").textContent="JoTrip tạm ẩn lớp đã quá hạn thay vì hiển thị như thời tiết hiện tại.";
  }
}

async function refreshCanonicalRuntime(){
  try{
    const manifest=await fetchCanonical(URLS.manifest);
    const before=JSON.stringify(state.runtimeManifest?.source_times||{});
    const after=JSON.stringify(manifest?.source_times||{});
    if(before===after){
      enforceSceneFreshness();
      return;
    }
    const [n,c,cur,e,d,m]=await Promise.allSettled([
      fetchCanonical(URLS.nowcast),fetchCanonical(URLS.compact),fetchCanonical(URLS.current),
      fetchCanonical(URLS.ecmwf),fetchCanonical(URLS.dashboard),fetchCanonical(URLS.marine)
    ]);
    state.runtimeManifest=manifest;
    if(n.status==="fulfilled")state.nowcast=n.value;
    if(c.status==="fulfilled")state.compact=c.value;
    if(cur.status==="fulfilled")state.current=cur.value;
    if(e.status==="fulfilled")state.ecmwf=e.value;
    if(d.status==="fulfilled")state.dashboard=d.value;
    if(m.status==="fulfilled")state.marine=m.value;
    setTabAvailability();
    let next=state.scene;
    if(!sceneAvailable(next))next=sceneAvailable("cloud")?"cloud":sceneAvailable("rain")?"rain":sceneAvailable("wind")?"wind":"wave";
    if(sceneAvailable(next))setScene(next);
    enforceSceneFreshness();
  }catch(e){
    console.warn("[Weather Scene] runtime refresh",e);
  }
}

async function boot(){
  if(EMBED) document.body.classList.add("embed-mode");
  initMap();
  bind();

  const [mf,n,c,cur,e,d,m]=await Promise.allSettled([
    fetchCanonical(URLS.manifest),
    fetchCanonical(URLS.nowcast),
    fetchCanonical(URLS.compact),
    fetchCanonical(URLS.current),
    fetchCanonical(URLS.ecmwf),
    fetchCanonical(URLS.dashboard),
    fetchCanonical(URLS.marine)
  ]);

  if(mf.status==="fulfilled"){
    state.runtimeManifest=mf.value;
    state.sources.manifest=true;
    if(mf.value?.policy?.browser_fallback!=="DISABLED" || mf.value?.policy?.frontend_source!=="SAME_ORIGIN_CANONICAL_ONLY"){
      throw new Error("Weather runtime source policy mismatch");
    }
  }else{
    throw new Error("Canonical Weather runtime manifest unavailable");
  }
  if(n.status==="fulfilled"){state.nowcast=n.value;state.sources.nowcast=true}
  if(c.status==="fulfilled"){state.compact=c.value;state.sources.compact=true}
  if(cur.status==="fulfilled"){state.current=cur.value;state.sources.current=true}
  if(e.status==="fulfilled"){state.ecmwf=e.value;state.sources.ecmwf=true}
  if(d.status==="fulfilled"){state.dashboard=d.value;state.sources.dashboard=true}
  if(m.status==="fulfilled"){state.marine=m.value;state.sources.marine=true}

  setTabAvailability();

  let initial="cloud";
  if(!sceneAvailable("cloud")&&sceneAvailable("rain")) initial="rain";
  if(!sceneAvailable(initial)&&sceneAvailable("wind")) initial="wind";

  if(sceneAvailable(initial)){
    setScene(initial);
    $("loading").classList.add("hidden");
  }else{
    $("loading").textContent="Chưa có nguồn dữ liệu nào đủ mới để dựng Weather Scene.";
  }
  setInterval(()=>{if(document.visibilityState==="visible")refreshCanonicalRuntime()},2*60*1000);
  setInterval(()=>{if(document.visibilityState==="visible")enforceSceneFreshness()},60*1000);
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")refreshCanonicalRuntime()});
}

boot();
})();