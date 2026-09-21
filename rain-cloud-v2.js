(() => {
"use strict";

const URLS = {
  nowcast: [
    "/data/weather-nowcast/latest.json",
    "https://raw.githubusercontent.com/kenzuko/Jotrip-Lab/data-weather/data/weather-nowcast/latest.json"
  ],
  ecmwf: [
    "/spatial-ecmwf.json",
    "https://raw.githubusercontent.com/kenzuko/Jotrip-Lab/feat/weather-lab-data-engine-v1/weather/spatial-ecmwf.json"
  ],
  current: [
    "https://raw.githubusercontent.com/kenzuko/Jotrip-Lab/data-weather/data/weather-current/latest.json"
  ]
};

const CARTO_KEY = "cb1_3q98_1_d8112ce70cc7ec9b9276b0a0";
const QUERY = new URLSearchParams(location.search);
const BASE_MODE = QUERY.get("base")==="voyager" ? "voyager" : "positron";
const STRUCTURE_MODE = QUERY.get("structure")!=="0";
const $ = (id) => document.getElementById(id);
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
const num = (v) => v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v);

const state = {
  map: null,
  nowcast: null,
  ecmwf: null,
  current: null,
  layer: "cloud",
  frames: [],
  index: 0,
  playing: false,
  timer: null,
  probe: {lat:10.2172, lon:103.9593},
  renderRAF: null
};

async function fetchJSON(url){
  const sep = url.includes("?") ? "&" : "?";
  const r = await fetch(url + sep + "t=" + Date.now(), {cache:"no-store"});
  if(!r.ok) throw new Error("HTTP " + r.status + " " + url);
  return r.json();
}
async function fetchFirst(urls){
  let last;
  for(const u of urls){
    try { return await fetchJSON(u); }
    catch(e){ last = e; }
  }
  throw last || new Error("No source");
}
function stamp(iso){
  if(!iso) return "--";
  const d = new Date(iso);
  if(Number.isNaN(d.getTime())) return "--";
  return new Intl.DateTimeFormat("vi-VN",{
    timeZone:"Asia/Ho_Chi_Minh", day:"2-digit", month:"2-digit",
    hour:"2-digit", minute:"2-digit", hour12:false
  }).format(d).replace(",", " ·");
}
function shortStamp(iso){
  if(!iso) return "--";
  const d = new Date(iso);
  return new Intl.DateTimeFormat("vi-VN",{
    timeZone:"Asia/Ho_Chi_Minh", hour:"2-digit", minute:"2-digit", hour12:false
  }).format(d);
}
function haversineKm(a,b,c,d){
  const R=6371.0088, rad=x=>x*Math.PI/180;
  const p1=rad(a), p2=rad(c), dp=rad(c-a), dl=rad(d-b);
  const q=Math.sin(dp/2)**2 + Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return 2*R*Math.asin(Math.sqrt(q));
}
function initMap(){
  state.map = L.map("map",{
    zoomControl:false, attributionControl:true,
    minZoom:8.1,maxZoom:12.3,zoomSnap:.25,zoomDelta:.5,
    preferCanvas:true
  });
  const z = innerWidth < 760 ? 8.65 : 9.0;
  state.map.setView([10.18,103.98],z);

  state.map.createPane("labels");
  state.map.getPane("labels").style.zIndex = "650";
  state.map.getPane("labels").style.pointerEvents = "none";

  const baseStyle = BASE_MODE==="voyager" ? "voyager" : "light";
  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/"+baseStyle+"_nolabels/{z}/{x}/{y}{r}.png?key="+CARTO_KEY,{
    subdomains:"abcd",maxZoom:19,
    attribution:'&copy; OpenStreetMap &copy; CARTO'
  }).addTo(state.map);

  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/"+baseStyle+"_only_labels/{z}/{x}/{y}{r}.png?key="+CARTO_KEY,{
    subdomains:"abcd",maxZoom:19,pane:"labels"
  }).addTo(state.map);

  state.map.on("move zoom resize", queueRender);
  state.map.on("click", (e)=>{
    state.probe={lat:e.latlng.lat,lon:e.latlng.lng};
    updateProbe();
  });
}
function currentCloudFrames(){
  return state.nowcast?.spatial?.frames || [];
}
function currentRainFrames(){
  const all = state.ecmwf?.spatial?.frames || [];
  if(!all.length) return [];
  const now = Date.now(), min = now - 3*3600e3, max = now + 72*3600e3;
  const sliced = all.filter(f=>{
    const t=Date.parse(f.valid_time||"");
    return Number.isFinite(t) && t>=min && t<=max;
  });
  return sliced.length ? sliced : all.slice(0,25);
}
function configureLayer(layer){
  state.layer = layer;
  document.querySelectorAll(".layer-switch button").forEach(b=>{
    b.classList.toggle("active", b.dataset.layer===layer);
  });

  stopPlay();
  if(layer==="cloud"){
    state.frames=currentCloudFrames();
    state.index=Math.max(0,state.frames.length-1);
  }else{
    state.frames=currentRainFrames();
    const now=Date.now();
    let best=0,dist=Infinity;
    state.frames.forEach((f,i)=>{
      const d=Math.abs(Date.parse(f.valid_time||"")-now);
      if(d<dist){dist=d;best=i;}
    });
    state.index=best;
  }
  $("timeSlider").max=String(Math.max(0,state.frames.length-1));
  $("timeSlider").value=String(state.index);
  updateUI();
  queueRender();
}
function currentFrame(){
  return state.frames[state.index] || null;
}
function updateUI(){
  const f=currentFrame();
  if(state.layer==="cloud"){
    $("stageBadge").textContent="QUAN TRẮC";
    $("stageTitle").textContent="Himawari-9 AHI";
    $("stageMeta").textContent=STRUCTURE_MODE
      ? "Mây quan trắc - màu + biên khối + relief từ chính trường dữ liệu"
      : "Mây quan trắc - chỉ màu, tắt cấu trúc";
    $("timeLabel").textContent=stamp(f?.sampled_time);
    $("timeKind").textContent="OBSERVED SATELLITE - không phải dự báo";
    $("resolutionLabel").textContent=state.nowcast?.spatial?.display_grid_deg
      ? "render " + state.nowcast.spatial.display_grid_deg + "°"
      : "AHI ~2 km nadir";
    $("readoutEyebrow").textContent="MÂY THẬT";
    $("readoutText").textContent="Màu và độ đậm lấy từ nhiệt độ đỉnh mây. Không dùng blob ngẫu nhiên và không biến điểm đối lưu thành hình mây giả.";
    renderLegendCloud();
  }else{
    $("stageBadge").textContent="DỰ BÁO";
    $("stageTitle").textContent="ECMWF IFS";
    $("stageMeta").textContent=STRUCTURE_MODE
      ? "Mưa ECMWF - màu + đường biên ngưỡng cường độ"
      : "Mưa ECMWF - chỉ màu, tắt cấu trúc";
    $("timeLabel").textContent=stamp(f?.valid_time);
    $("timeKind").textContent=(f?.lead_hours===0?"MODEL ANALYSIS":"FORECAST") + " - lượng mưa theo bước mô hình";
    $("resolutionLabel").textContent=(state.ecmwf?.spatial?.requested_grid_deg || .25) + "° source grid";
    $("readoutEyebrow").textContent="MƯA MÔ HÌNH";
    $("readoutText").textContent="Không tạo các cụm mưa nhỏ hơn ô ECMWF. Điểm đo VRain được vẽ riêng để phân biệt dữ liệu thực tế với trường dự báo.";
    renderLegendRain();
  }
  $("timeSlider").value=String(state.index);
  updateActualBox();
  updateProbe();
}
function renderLegendCloud(){
  $("legend").innerHTML =
    '<div class="legend-title">ĐỈNH MÂY IR</div>'+
    '<div class="legend-bar" style="background:linear-gradient(90deg,#aab9c1,#cfdae1,#a9c8dc,#998ac5,#715aaf)"></div>'+
    '<div class="legend-scale"><span>ấm / thấp</span><span>-40°C</span><span>rất lạnh / cao</span></div>'+
    '<div class="legend-scale" style="margin-top:5px"><span>biên tối = đổi tầng</span><span>viền tím = lõi đối lưu</span></div>';
}
function renderLegendRain(){
  $("legend").innerHTML =
    '<div class="legend-title">MƯA / BƯỚC MODEL</div>'+
    '<div class="legend-bar" style="background:linear-gradient(90deg,#4d93d6,#31bcd9,#23bc94,#d7cf4a,#f19137,#de5046,#bc336c)"></div>'+
    '<div class="legend-scale"><span>0.2</span><span>3</span><span>12</span><span>40+ mm</span></div>'+
    '<div class="legend-scale" style="margin-top:5px"><span>đường biên = đổi ngưỡng mưa</span><span></span></div>';
}
function updateActualBox(){
  const rain=state.current?.groundtruth?.rainfall;
  if(state.layer!=="rain" || !rain?.stations){
    $("actualBox").innerHTML='<b>Phân lớp dữ liệu</b><br>Observed satellite ≠ model forecast.';
    return;
  }
  const rows=Object.values(rain.stations);
  const txt=rows.map(g=>{
    const recent=g.rain_recently_observed===true ? "đang/ vừa có mưa" :
      g.rain_recently_observed===false ? "không ghi nhận mưa gần đây" : "chưa đủ mẫu";
    return '<b>'+g.station_name+'</b>: '+recent;
  }).join("<br>");
  $("actualBox").innerHTML='<b>VRain - ACTUAL</b><br>'+txt;
}
function gridFromRows(rows,valueFn){
  const valid=(rows||[]).map(r=>({lat:num(r.lat),lon:num(r.lon),v:num(valueFn(r)),row:r}))
    .filter(r=>r.lat!==null&&r.lon!==null&&r.v!==null);
  if(!valid.length) return null;
  const lats=[...new Set(valid.map(r=>r.lat))].sort((a,b)=>a-b);
  const lons=[...new Set(valid.map(r=>r.lon))].sort((a,b)=>a-b);
  if(lats.length<2||lons.length<2) return null;
  const values=new Map(valid.map(r=>[r.lat.toFixed(5)+"|"+r.lon.toFixed(5),r.v]));
  const dLat=(lats[lats.length-1]-lats[0])/(lats.length-1);
  const dLon=(lons[lons.length-1]-lons[0])/(lons.length-1);
  return {lats,lons,values,dLat,dLon,lat0:lats[0],lon0:lons[0],lat1:lats.at(-1),lon1:lons.at(-1)};
}
function sampleGrid(g,lat,lon){
  if(!g || lat<g.lat0 || lat>g.lat1 || lon<g.lon0 || lon>g.lon1) return null;
  const fy=(lat-g.lat0)/g.dLat, fx=(lon-g.lon0)/g.dLon;
  const y0=clamp(Math.floor(fy),0,g.lats.length-2), x0=clamp(Math.floor(fx),0,g.lons.length-2);
  const y1=y0+1,x1=x0+1, ty=clamp(fy-y0,0,1),tx=clamp(fx-x0,0,1);
  const get=(y,x)=>g.values.get(g.lats[y].toFixed(5)+"|"+g.lons[x].toFixed(5));
  const q00=get(y0,x0),q10=get(y0,x1),q01=get(y1,x0),q11=get(y1,x1);
  const vals=[[q00,(1-tx)*(1-ty)],[q10,tx*(1-ty)],[q01,(1-tx)*ty],[q11,tx*ty]];
  let sw=0,sv=0;
  for(const [v,w] of vals){ if(v!==undefined&&Number.isFinite(v)){sw+=w;sv+=v*w;} }
  return sw>0?sv/sw:null;
}
function mix(a,b,t){return Math.round(a+(b-a)*t);}
function ramp(stops,t){
  t=clamp(t,0,1);
  for(let i=1;i<stops.length;i++){
    if(t<=stops[i][0]){
      const a=stops[i-1],b=stops[i],q=(t-a[0])/Math.max(.0001,b[0]-a[0]);
      return [mix(a[1][0],b[1][0],q),mix(a[1][1],b[1][1],q),mix(a[1][2],b[1][2],q)];
    }
  }
  return stops.at(-1)[1];
}
function rainStyle(mm){
  if(mm===null || mm<.10) return [0,0,0,0];
  const stops=[[.10,.05],[.20,.13],[.50,.22],[1,.31],[3,.47],[7,.62],[12,.74],[22,.87],[40,1]];
  let t=1;
  for(let i=1;i<stops.length;i++){
    if(mm<=stops[i][0]){
      const a=stops[i-1],b=stops[i],q=(mm-a[0])/(b[0]-a[0]);
      t=a[1]+(b[1]-a[1])*q;break;
    }
  }
  const rgb=ramp([
    [0,[77,147,214]],[.18,[49,188,217]],[.38,[35,188,148]],
    [.58,[215,207,74]],[.76,[241,145,55]],[.90,[222,80,70]],[1,[188,51,108]]
  ],t);
  const alpha=clamp(.10+Math.pow(t,.68)*.78,.10,.88);
  return [rgb[0],rgb[1],rgb[2],Math.round(alpha*255)];
}
function cloudStyle(cold){
  if(cold===null || cold>10) return [0,0,0,0];
  const t=clamp((8-cold)/88,0,1);
  const rgb=ramp([
    [0,[161,177,186]],[.24,[187,201,209]],[.46,[205,218,225]],
    [.66,[169,200,220]],[.82,[153,139,197]],[1,[113,90,175]]
  ],t);
  const alpha=clamp(.07+Math.pow(t,.82)*.72,.07,.79);
  return [rgb[0],rgb[1],rgb[2],Math.round(alpha*255)];
}
function rainBand(v){
  if(v===null || !Number.isFinite(v) || v<.10) return -1;
  const t=[.2,.5,1,3,7,12,22,40];
  let b=0;
  while(b<t.length && v>=t[b]) b++;
  return b;
}
function cloudBand(v){
  if(v===null || !Number.isFinite(v) || v>10) return -1;
  const t=[0,-15,-30,-45,-55,-65,-75];
  let b=0;
  while(b<t.length && v<=t[b]) b++;
  return b;
}
function strengthForStructure(v,layer){
  if(v===null || !Number.isFinite(v)) return 0;
  if(layer==="rain") return clamp(Math.log1p(Math.max(0,v))/Math.log(41),0,1);
  return clamp((8-v)/88,0,1);
}
function renderStructure(ctx,field,w,h,layer,convField){
  ctx.clearRect(0,0,w,h);
  if(!STRUCTURE_MODE || !field?.length) return;
  const img=ctx.createImageData(w,h);
  const px=img.data;
  const bandFn=layer==="rain" ? rainBand : cloudBand;
  const stride=Math.max(1,Math.round(w/560));
  for(let y=1;y<h-1;y++){
    for(let x=1;x<w-1;x++){
      const i=y*w+x, v=field[i];
      if(!Number.isFinite(v)) continue;
      const s=strengthForStructure(v,layer);
      if(s<=.02) continue;
      const l=field[i-1], r=field[i+1], u=field[i-w], d=field[i+w];
      if(![l,r,u,d].every(Number.isFinite)) continue;

      // Directional relief from the SAME scalar field. It improves topology legibility,
      // but does not claim literal 3-D cloud thickness.
      const gx=strengthForStructure(r,layer)-strengthForStructure(l,layer);
      const gy=strengthForStructure(d,layer)-strengthForStructure(u,layer);
      const light=clamp(-(gx*.78+gy*.52)*2.7,-1,1);
      const k=i*4;
      if(Math.abs(light)>.025){
        if(light>0){
          px[k]=255;px[k+1]=255;px[k+2]=255;
          px[k+3]=Math.round((10+44*Math.abs(light))*s);
        }else{
          px[k]=18;px[k+1]=42;px[k+2]=51;
          px[k+3]=Math.round((8+50*Math.abs(light))*s);
        }
      }

      // Isoline-like boundary wherever a meaningful threshold band changes.
      const b=bandFn(v);
      const edge=b!==bandFn(r) || b!==bandFn(d);
      if(edge && b>=0 && ((x+y)%stride===0)){
        px[k]=layer==="rain"?24:35;
        px[k+1]=layer==="rain"?55:51;
        px[k+2]=layer==="rain"?66:67;
        px[k+3]=layer==="rain"?72:62;
      }

      // Cloud convective structure: thin violet core boundary from observed score.
      if(layer==="cloud" && convField){
        const cv=convField[i];
        const cr=convField[i+1], cd=convField[i+w];
        if(Number.isFinite(cv) && cv>=20 && Number.isFinite(cr) && Number.isFinite(cd)){
          const core=Math.floor(cv/15);
          if(core!==Math.floor(cr/15) || core!==Math.floor(cd/15)){
            px[k]=102;px[k+1]=74;px[k+2]=168;px[k+3]=Math.min(118,54+Math.round(cv));
          }
        }
      }
    }
  }
  ctx.putImageData(img,0,0);
}
function sizeCanvas(canvas){
  const rect=$("map").getBoundingClientRect();
  const scale=innerWidth<760?.58:.50;
  const w=Math.max(180,Math.round(rect.width*scale));
  const h=Math.max(220,Math.round(rect.height*scale));
  if(canvas.width!==w||canvas.height!==h){
    canvas.width=w;canvas.height=h;
    canvas.style.width=rect.width+"px";canvas.style.height=rect.height+"px";
  }
  return {w,h,scale,rect};
}
function renderField(){
  const f=currentFrame(), canvas=$("weatherCanvas"), relief=$("reliefCanvas");
  const {w,h,scale}=sizeCanvas(canvas);
  sizeCanvas(relief);
  const ctx=canvas.getContext("2d"), rctx=relief.getContext("2d");
  ctx.clearRect(0,0,w,h);rctx.clearRect(0,0,w,h);
  if(!f)return;

  let rows,valueFn,styleFn;
  if(state.layer==="cloud"){
    rows=f.cells||[];
    valueFn=r=>r.cloud_top_cold_c;
    styleFn=cloudStyle;
  }else{
    rows=f.cells||[];
    valueFn=r=>r.rain_mm;
    styleFn=rainStyle;
  }
  const grid=gridFromRows(rows,valueFn);
  if(!grid)return;

  const img=ctx.createImageData(w,h);
  const field=new Float32Array(w*h); field.fill(NaN);
  let convGrid=null, convField=null;
  if(state.layer==="cloud"){
    convGrid=gridFromRows(rows,r=>r.convective_score);
    convField=new Float32Array(w*h); convField.fill(NaN);
  }
  const west=state.map.containerPointToLatLng([0,0]).lng;
  const east=state.map.containerPointToLatLng([w/scale,0]).lng;
  const latRows=new Float32Array(h);
  for(let y=0;y<h;y++){
    latRows[y]=state.map.containerPointToLatLng([0,y/scale]).lat;
  }

  for(let y=0;y<h;y++){
    const lat=latRows[y];
    for(let x=0;x<w;x++){
      const lon=west+(east-west)*(x/(w-1));
      const i=y*w+x;
      const v=sampleGrid(grid,lat,lon);
      field[i]=v===null?NaN:v;
      if(convGrid){
        const cv=sampleGrid(convGrid,lat,lon);
        convField[i]=cv===null?NaN:cv;
      }
      const c=styleFn(v);
      const k=i*4;
      img.data[k]=c[0];img.data[k+1]=c[1];img.data[k+2]=c[2];img.data[k+3]=c[3];
    }
  }
  ctx.putImageData(img,0,0);
  renderStructure(rctx,field,w,h,state.layer,convField);

  if(state.layer==="rain"){
    drawActualGauges(ctx,scale);
  }
}
function drawActualGauges(ctx,scale){
  const stations=state.current?.groundtruth?.rainfall?.stations;
  if(!stations)return;
  ctx.save();
  Object.values(stations).forEach(g=>{
    const p=state.map.latLngToContainerPoint([g.lat,g.lon]);
    const x=p.x*scale,y=p.y*scale;
    if(x<0||x>ctx.canvas.width||y<0||y>ctx.canvas.height)return;
    const wet=g.rain_recently_observed===true;
    ctx.beginPath();ctx.arc(x,y,wet?7:5,0,Math.PI*2);
    ctx.fillStyle=wet?"rgba(13,113,142,.98)":"rgba(255,255,255,.96)";
    ctx.fill();
    ctx.lineWidth=2;ctx.strokeStyle=wet?"rgba(255,255,255,.95)":"rgba(30,86,101,.9)";ctx.stroke();
  });
  ctx.restore();
}
function queueRender(){
  if(state.renderRAF) cancelAnimationFrame(state.renderRAF);
  state.renderRAF=requestAnimationFrame(renderField);
}
function nearestRow(rows,lat,lon){
  let best=null,dist=Infinity;
  (rows||[]).forEach(r=>{
    const d=(r.lat-lat)**2+(r.lon-lon)**2;
    if(d<dist){dist=d;best=r;}
  });
  return best;
}
function updateProbe(){
  const f=currentFrame();
  if(!f)return;
  const row=nearestRow(f.cells||[],state.probe.lat,state.probe.lon);
  if(!row)return;
  if(state.layer==="cloud"){
    const cold=num(row.cloud_top_cold_c), high=num(row.cloud_top_high_m), score=num(row.convective_score);
    $("readoutValue").textContent=(cold===null?"--":cold.toFixed(1)+"°C") + " đỉnh mây";
    $("readoutText").textContent=
      "Ô quan trắc gần nhất: " +
      (high===null?"chưa có độ cao":Math.round(high/100)/10+" km") +
      " · tín hiệu đối lưu " + (score===null?"--":Math.round(score)+"/100") +
      ". Giá trị màu là IR cloud-top, không phải xác suất mưa.";
  }else{
    const rain=num(row.rain_mm);
    const stations=Object.values(state.current?.groundtruth?.rainfall?.stations||{});
    let near=null,dist=Infinity;
    stations.forEach(g=>{
      const d=haversineKm(state.probe.lat,state.probe.lon,g.lat,g.lon);
      if(d<dist){dist=d;near=g;}
    });
    $("readoutValue").textContent=(rain===null?"--":rain.toFixed(2)+" mm") + " / bước";
    $("readoutText").textContent="ECMWF tại ô gần nhất. " +
      (near ? "Trạm thực tế gần nhất: "+near.station_name+" ("+dist.toFixed(1)+" km), "+
        (near.rain_recently_observed===true?"có mưa gần đây":near.rain_recently_observed===false?"không ghi nhận mưa gần đây":"chưa đủ mẫu hiện tại")+".":"");
  }
}
function play(){
  if(state.playing){stopPlay();return;}
  state.playing=true;$("playBtn").textContent="❚❚";
  const delay=state.layer==="cloud"?650:900;
  state.timer=setInterval(()=>{
    state.index=(state.index+1)%Math.max(1,state.frames.length);
    $("timeSlider").value=String(state.index);
    updateUI();queueRender();
  },delay);
}
function stopPlay(){
  state.playing=false;$("playBtn").textContent="▶";
  if(state.timer)clearInterval(state.timer);
  state.timer=null;
}
function bind(){
  document.querySelectorAll(".layer-switch button").forEach(b=>{
    b.addEventListener("click",()=>configureLayer(b.dataset.layer));
  });
  $("timeSlider").addEventListener("input",e=>{
    stopPlay();state.index=Number(e.target.value)||0;updateUI();queueRender();
  });
  $("playBtn").addEventListener("click",play);
  $("fitBtn").addEventListener("click",()=>{
    const z=innerWidth<760?8.65:9.0;
    state.map.setView([10.18,103.98],z);
  });
  addEventListener("resize",queueRender,{passive:true});
}
async function boot(){
  initMap();bind();
  try{
    const [nowcast,ecmwf,current]=await Promise.all([
      fetchFirst(URLS.nowcast),fetchFirst(URLS.ecmwf),fetchFirst(URLS.current)
    ]);
    state.nowcast=nowcast;state.ecmwf=ecmwf;state.current=current;
    configureLayer("cloud");
    $("loading").classList.add("hidden");
    setTimeout(queueRender,120);
  }catch(e){
    console.error("[RainCloudV2]",e);
    $("loading").textContent="Không tải được một nguồn dữ liệu. Mở console để kiểm tra.";
  }
}
boot();
})();