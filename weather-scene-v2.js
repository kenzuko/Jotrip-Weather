(()=>{"use strict";

const URLS={
  nowcast:[
    "/data/weather-nowcast/latest.json",
    "https://raw.githubusercontent.com/kenzuko/Jotrip-Lab/data-weather/data/weather-nowcast/latest.json"
  ],
  compact:[
    "/data/weather-nowcast/compact-latest.json",
    "https://raw.githubusercontent.com/kenzuko/Jotrip-Lab/data-weather/data/weather-nowcast/compact-latest.json"
  ],
  current:[
    "https://raw.githubusercontent.com/kenzuko/Jotrip-Lab/data-weather/data/weather-current/latest.json"
  ],
  ecmwf:[
    "/spatial-ecmwf.json",
    "https://raw.githubusercontent.com/kenzuko/Jotrip-Lab/feat/weather-lab-data-engine-v1/weather/spatial-ecmwf.json"
  ]
};

const CARTO_KEY="cb1_3q98_1_d8112ce70cc7ec9b9276b0a0";
const NAMES={
  duong_dong:"Dương Đông",an_thoi:"An Thới",ganh_dau:"Gành Dầu",
  cua_can:"Cửa Cạn",bai_thom:"Bãi Thơm",ham_ninh:"Hàm Ninh",bai_sao:"Bãi Sao"
};
const $=id=>document.getElementById(id);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const num=v=>v===null||v===undefined||v===""||Number.isNaN(Number(v))?null:Number(v);

const state={
  map:null,
  nowcast:null,
  compact:null,
  current:null,
  ecmwf:null,
  scene:"cloud",
  frames:[],
  index:0,
  playing:false,
  timer:null,
  raf:null,
  particles:[],
  actualLayer:null,
  probe:null,
  sources:{nowcast:false,compact:false,current:false,ecmwf:false}
};

async function fetchJSON(url){
  const r=await fetch(url+(url.includes("?")?"&":"?")+"t="+Date.now(),{cache:"no-store"});
  if(!r.ok) throw new Error("HTTP "+r.status+" "+url);
  return r.json();
}
function payloadTime(payload){
  const candidates=[
    payload?.sampled_time,
    payload?.generated_at,
    payload?.spatial?.short_run_time,
    payload?.run_time,
    payload?.valid_time
  ];
  for(const value of candidates){
    const t=Date.parse(value||"");
    if(Number.isFinite(t)) return t;
  }
  return -Infinity;
}
async function fetchFreshest(urls){
  const results=await Promise.allSettled(urls.map(fetchJSON));
  const good=results.filter(r=>r.status==="fulfilled").map(r=>r.value);
  if(!good.length) throw new Error("No source");
  good.sort((a,b)=>payloadTime(b)-payloadTime(a));
  return good[0];
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
function ageMinutes(iso){
  const t=Date.parse(iso||"");
  return Number.isFinite(t)?Math.max(0,(Date.now()-t)/60000):null;
}
function freshnessText(iso,kind){
  const a=ageMinutes(iso);
  if(a===null) return {text:"không rõ thời gian",stale:true};
  const staleLimit=kind==="satellite"?75:kind==="actual"?90:420;
  if(a>staleLimit) return {text:"dữ liệu trễ · "+Math.round(a)+"p",stale:true};
  if(a<2) return {text:"vừa cập nhật",stale:false};
  return {text:Math.round(a)+"p trước",stale:false};
}

function initMap(){
  state.map=L.map("map",{
    zoomControl:false,attributionControl:true,
    minZoom:8.1,maxZoom:12.2,zoomSnap:.25,zoomDelta:.5,preferCanvas:true
  }).setView([10.18,103.98],innerWidth<760?8.65:9);

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

  // Move renderer canvases inside Leaflet's stacking context so labels can sit above weather.
  state.map.getContainer().appendChild($("fieldCanvas"));
  state.map.getContainer().appendChild($("motionCanvas"));

  state.actualLayer=L.layerGroup().addTo(state.map);

  state.map.on("move zoom resize",queueRender);
  state.map.on("click",e=>{
    state.probe={lat:e.latlng.lat,lon:e.latlng.lng};
    updateSourcePanel();
  });
}

function cloudFrames(){
  return state.nowcast?.spatial?.frames||[];
}
function forecastFrames(){
  const all=state.ecmwf?.spatial?.frames||[];
  const now=Date.now(), max=now+72*3600e3;
  const sliced=all.filter(f=>{
    const t=Date.parse(f.valid_time||"");
    return Number.isFinite(t)&&t>=now-4*3600e3&&t<=max;
  });
  return sliced.length?sliced:all.slice(0,25);
}
function sceneAvailable(scene){
  if(scene==="cloud") return cloudFrames().length>0;
  return forecastFrames().length>0;
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
  stop();
  document.querySelectorAll(".tabs button").forEach(b=>b.classList.toggle("active",b.dataset.scene===scene));
  state.frames=scene==="cloud"?cloudFrames():forecastFrames();

  if(scene==="cloud"){
    state.index=Math.max(0,state.frames.length-1);
  }else{
    let best=0,dist=Infinity;
    state.frames.forEach((f,i)=>{
      const d=Math.abs(Date.parse(f.valid_time||"")-Date.now());
      if(d<dist){dist=d;best=i}
    });
    state.index=best;
  }

  $("slider").max=String(Math.max(0,state.frames.length-1));
  $("slider").value=String(state.index);
  seedParticles();
  renderActualStations();
  updateCopy();
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
    summary+=" Hướng dịch chuyển hiện chưa đạt chuẩn public.";
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

  let wet=0,known=0,unknown=0;
  for(const g of stations){
    if(g.rain_recently_observed===true){wet++;known++;continue}
    if(g.rain_recently_observed===false && g.increment_qc!=="WINDOW_TOO_OLD_FOR_CURRENT_RAIN"){known++;continue}
    unknown++;
  }
  if(wet>0) return {label:wet+"/"+stations.length+" trạm ghi nhận mưa gần đây",wet,known,unknown};
  if(known===stations.length) return {label:"Các trạm VRain đang nối chưa ghi nhận mưa gần đây",wet,known,unknown};
  return {label:"VRain có dữ liệu nhưng cửa sổ mưa hiện tại chưa đủ ở một số trạm",wet,known,unknown};
}
function maxRainInFrame(f){
  return Math.max(0,...(f?.cells||[]).map(c=>Number(c.rain_mm)||0));
}
function maxWindInFrame(f){
  return Math.max(0,...(f?.cells||[]).map(c=>Number(c.wind_kmh)||0));
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
    $("timeMeta").textContent="Himawari-9 · observed";
    $("timeClass").textContent="OBSERVED";
    $("timeClass").className="time-class observed";
    sourceTime=f?.sampled_time||state.nowcast?.sampled_time;
    kind="satellite";
    $("legend").innerHTML=
      '<b>Mây</b>'+
      '<div class="bar" style="background:linear-gradient(90deg,#c8d0d4,#e1e7e9,#b5d5e4,#e9d36a,#e9904a,#c9545b)"></div>'+
      '<div class="scale"><span>mây thường</span><span>đỉnh lạnh/cao</span></div>';
  }

  if(state.scene==="rain"){
    const actual=rainActualState();
    const peak=maxRainInFrame(f);
    $("eyebrow").textContent="DỰ BÁO + ĐIỂM ACTUAL";
    $("headline").textContent=peak<.2?"Mưa dự báo rất ít trong bước này":"Trường mưa ECMWF";
    $("summary").textContent="Màu là dự báo ECMWF 0.25°. Các chấm trạm VRain là quan trắc thực tế và không được trộn vào field dự báo.";
    $("facts").innerHTML=
      "<span>"+actual.label+"</span>"+
      "<span>Đỉnh ô model "+peak.toFixed(1)+" mm</span>";
    $("timeLabel").textContent=stamp(f?.valid_time);
    $("timeMeta").textContent="ECMWF · forecast";
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
    $("summary").textContent="Particle biểu diễn trường gió ECMWF ở 10 m. Đây không phải hướng dịch chuyển của mây.";
    $("facts").innerHTML="<span>Gió mạnh nhất trên khung ≈ "+Math.round(peak)+" km/h</span><span>u10/v10</span>";
    $("timeLabel").textContent=stamp(f?.valid_time);
    $("timeMeta").textContent="ECMWF · surface wind";
    $("timeClass").textContent="FORECAST";
    $("timeClass").className="time-class forecast";
    sourceTime=state.ecmwf?.generated_at||f?.valid_time;
    kind="forecast";
    $("legend").innerHTML='<b>Gió 10 m</b><div class="scale"><span>particle = hướng trường gió</span></div>';
  }

  const fresh=freshnessText(sourceTime,kind);
  $("freshness").textContent=fresh.text;
  $("freshness").classList.toggle("stale",fresh.stale);
  $("slider").value=String(state.index);
  updateSourcePanel();
}

function updateSourcePanel(){
  let title="",text="",meta=[];
  const f=frame();

  if(state.scene==="cloud"){
    title="Himawari-9 · cloud-top";
    text="Observed satellite. Renderer dùng màu có chọn lọc: mây thường giữ trung tính, chỉ đỉnh mây lạnh/cao mới nhận màu mạnh. Không có icon sét vì lightning feed trực tiếp chưa được nối.";
    meta=[
      "Nguồn: "+(state.nowcast?.source||"JMA Himawari-9 via NOAA Open Data"),
      "Native source: "+(state.nowcast?.observation_resolution||"~2 km ở nadir"),
      "Render grid hiện tại: "+(state.nowcast?.spatial?.display_grid_deg||0.05)+"°",
      "Motion public: tạm khóa cho đến khi feature tracking được xác minh"
    ];
  }else if(state.scene==="rain"){
    title="ECMWF + VRain";
    text="Raster màu là MODEL FORECAST. Điểm trạm là ACTUAL khi cửa sổ quan trắc đủ điều kiện. Hai lớp giữ tách biệt.";
    meta=[
      "ECMWF source grid: "+(state.ecmwf?.spatial?.requested_grid_deg||0.25)+"°",
      "Interpolation: render only",
      "VRain: "+(state.current?.groundtruth?.rainfall?.status||"không sẵn sàng"),
      "Không tạo chi tiết mưa nhỏ hơn source grid"
    ];
  }else{
    title="ECMWF · surface wind";
    text="Particle chỉ phục vụ đọc hướng của trường u10/v10 và luôn để basemap nhìn thấy. Không dùng particle gió mặt đất để diễn đạt cloud motion.";
    meta=[
      "Độ cao: 10 m",
      "Source grid: "+(state.ecmwf?.spatial?.requested_grid_deg||0.25)+"°",
      "Data class: MODEL FORECAST"
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

function cloudStyle(c){
  if(c===null||c>-8) return [0,0,0,0];

  // On the darker satellite basemap, warm/low cloud stays pale while colder
  // cloud gains both luminance contrast and chroma. No contours or fake relief.
  if(c>-22){
    const t=between(c,-8,-22);
    const rgb=ramp([[0,[221,228,231]],[1,[239,244,245]]],t);
    return [...rgb,Math.round((.10+t*.16)*255)];
  }
  if(c>-38){
    const t=between(c,-22,-38);
    const rgb=ramp([[0,[236,243,244]],[1,[154,207,229]]],t);
    return [...rgb,Math.round((.26+t*.20)*255)];
  }
  if(c>-48){
    const t=between(c,-38,-48);
    const rgb=ramp([[0,[154,207,229]],[1,[86,177,215]]],t);
    return [...rgb,Math.round((.46+t*.10)*255)];
  }
  if(c>-58){
    const t=between(c,-48,-58);
    const rgb=ramp([[0,[86,177,215]],[1,[231,211,91]]],t);
    return [...rgb,Math.round((.56+t*.09)*255)];
  }
  if(c>-68){
    const t=between(c,-58,-68);
    const rgb=ramp([[0,[231,211,91]],[1,[238,137,68]]],t);
    return [...rgb,Math.round((.65+t*.07)*255)];
  }
  const t=between(c,-68,-82);
  const rgb=ramp([[0,[238,137,68]],[1,[191,67,82]]],t);
  return [...rgb,Math.round((.72+t*.06)*255)];
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
  const c=$("fieldCanvas"),m=$("motionCanvas"),{w,h,scale}=sizeCanvas(c);
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
  const g=grid(rows,state.scene==="cloud"?"cloud_top_cold_c":"rain_mm");
  if(!g) return;

  const img=ctx.createImageData(w,h);
  const west=state.map.containerPointToLatLng([0,0]).lng;
  const east=state.map.containerPointToLatLng([w/scale,0]).lng;

  for(let y=0;y<h;y++){
    const lat=state.map.containerPointToLatLng([0,y/scale]).lat;
    for(let x=0;x<w;x++){
      const lon=west+(east-west)*(x/(w-1));
      const v=sampleGrid(g,lat,lon);
      const col=state.scene==="cloud"?cloudStyle(v):rainStyle(v);
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

function renderActualStations(){
  if(!state.actualLayer) return;
  state.actualLayer.clearLayers();
  if(state.scene!=="rain") return;

  const stations=Object.values(state.current?.groundtruth?.rainfall?.stations||{});
  for(const g of stations){
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

function queueRender(){
  if(state.raf) cancelAnimationFrame(state.raf);
  state.raf=requestAnimationFrame(renderScalar);
}
function play(){
  if(state.playing){stop();return}
  state.playing=true;
  $("playBtn").textContent="❚❚";
  const delay=state.scene==="cloud"?950:1150;
  state.timer=setInterval(()=>{
    state.index=(state.index+1)%Math.max(1,state.frames.length);
    $("slider").value=String(state.index);
    updateCopy();
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

function bind(){
  document.querySelectorAll(".tabs button").forEach(b=>{
    b.addEventListener("click",()=>setScene(b.dataset.scene));
  });
  $("slider").addEventListener("input",e=>{
    stop();
    state.index=Number(e.target.value)||0;
    updateCopy();
    seedParticles();
    queueRender();
  });
  $("playBtn").addEventListener("click",play);
  $("infoBtn").addEventListener("click",()=>{
    const panel=$("sourcePanel");
    const open=panel.hidden;
    panel.hidden=!open;
    $("infoBtn").setAttribute("aria-expanded",String(open));
    if(open) updateSourcePanel();
  });
  addEventListener("resize",queueRender,{passive:true});
}

async function boot(){
  initMap();
  bind();

  const [n,c,cur,e]=await Promise.allSettled([
    fetchFreshest(URLS.nowcast),
    fetchFreshest(URLS.compact),
    fetchFreshest(URLS.current),
    fetchFreshest(URLS.ecmwf)
  ]);

  if(n.status==="fulfilled"){state.nowcast=n.value;state.sources.nowcast=true}
  if(c.status==="fulfilled"){state.compact=c.value;state.sources.compact=true}
  if(cur.status==="fulfilled"){state.current=cur.value;state.sources.current=true}
  if(e.status==="fulfilled"){state.ecmwf=e.value;state.sources.ecmwf=true}

  setTabAvailability();

  let initial="cloud";
  if(!sceneAvailable("cloud")&&sceneAvailable("rain")) initial="rain";
  if(!sceneAvailable(initial)&&sceneAvailable("wind")) initial="wind";

  if(sceneAvailable(initial)){
    setScene(initial);
    $("loading").classList.add("hidden");
  }else{
    $("loading").textContent="Chưa có nguồn dữ liệu nào đủ để dựng Weather Scene.";
  }
}

boot();
})();