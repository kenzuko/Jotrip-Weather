(()=>{
"use strict";
const KEY_HASH="e2b364cec6ff574866921d47cf621277833091cf9934b930a8a31e581e061269";
const ANALYTICS_URL="https://raw.githubusercontent.com/kenzuko/Jotrip-Lab/data-weather/data/weather-analytics/latest.json";
const CALIBRATION_URL="https://raw.githubusercontent.com/kenzuko/Jotrip-Lab/data-weather/data/weather-calibration/latest.json";
const $=id=>document.getElementById(id);
let analyticsData=null;
const num=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
const esc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
const fmt=(v,d=1)=>num(v)===null?"-":Number(v).toFixed(d);
function localTime(v){
  const d=new Date(v);if(!Number.isFinite(d.getTime()))return "-";
  return new Intl.DateTimeFormat("vi-VN",{timeZone:"Asia/Ho_Chi_Minh",day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).format(d).replace(","," ·");
}
async function sha256(text){
  const b=new TextEncoder().encode(text);
  const h=await crypto.subtle.digest("SHA-256",b);
  return [...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
async function getJSON(url){
  const r=await fetch(url+(url.includes("?")?"&":"?")+"t="+Date.now(),{cache:"no-store"});
  if(!r.ok)throw new Error("HTTP "+r.status);
  return r.json();
}
function unit(variable){
  return variable==="temperature"?"°C":variable==="wind"?"km/h":variable==="rain"?"mm":"";
}
function anchorName(v){
  return ({vvpq:"VVPQ",vrain_cua_can:"VRain Cửa Cạn",vrain_bai_thom:"VRain Bãi Thơm",vrain_an_thoi:"VRain An Thới"}[v]||v);
}
function variableName(v){return ({temperature:"Nhiệt độ",wind:"Gió",rain:"Mưa"}[v]||v)}
function leadName(v){return ({D0_24:"D0 · 0-24h",D1_48:"D1 · 25-48h",D2_72:"D2 · 49-72h",D3_5:"D3-5 · 73-120h",D6_10:"D6-10 · 121-240h"}[v]||v)}
function statusPill(s){
  const ready=String(s).toUpperCase()==="READY";
  return '<span class="pill '+(ready?'ready':'learning')+'">'+esc(ready?"READY":"LEARNING")+'</span>';
}
function renderSummary(a){
  const cards=[
    ["Matched cases",a.matched_cases??0,"Forecast đã đối chiếu ACTUAL"],
    ["Calibration",a.learning_status||"LEARNING",(a.ready_groups??0)+"/"+(a.total_groups??0)+" nhóm READY"],
    ["Ground Truth",a.groundtruth_archive_files??0,"snapshot đã lưu"],
    ["Forecast archive",a.forecast_archive_files??0,"cycle bất biến"],
    ["Ngưỡng học",a.minimum_samples??30,"case / nhóm"],
  ];
  $("summary").innerHTML=cards.map(x=>'<article class="summary-card"><span>'+esc(x[0])+'</span><b>'+esc(x[1])+'</b><small>'+esc(x[2])+'</small></article>').join("");
}
function renderActual(a){
  const latest=a.latest_actual||{},cards=[];
  if(latest.vvpq){
    cards.push('<article class="actual-card"><span>VVPQ · ACTUAL</span><b>'+fmt(latest.vvpq.wind_kmh,1)+' km/h</b><small>'+fmt(latest.vvpq.temperature_c,1)+'°C · '+esc(localTime(latest.vvpq.observed_at))+'</small></article>');
  }
  Object.entries(latest.rain||{}).forEach(([id,r])=>{
    const rain=num(r.increment_mm);
    const state=rain===null?"chưa có increment":rain>0?fmt(rain,2)+" mm":"0 mm · không mưa";
    cards.push('<article class="actual-card"><span>'+esc(anchorName(id))+' · ACTUAL</span><b>'+esc(state)+'</b><small>'+esc(localTime(r.observed_at))+' · '+(r.window_minutes?fmt(r.window_minutes,0)+' phút':'window n/a')+'</small></article>');
  });
  $("actualGrid").innerHTML=cards.join("")||'<article class="actual-card"><b>Chưa có ACTUAL</b></article>';
}
function renderGroups(a){
  const min=Number(a.minimum_samples||30);
  const rows=(a.groups||[]).slice().sort((x,y)=>
    anchorName(x.target).localeCompare(anchorName(y.target))||variableName(x.variable).localeCompare(variableName(y.variable))||String(x.lead_bucket).localeCompare(String(y.lead_bucket))
  );
  $("calibrationRows").innerHTML=rows.map(g=>{
    const n=Number(g.sample_count||0),pct=Math.min(100,Math.round(100*n/min));
    let correction="-";
    if(num(g.applied_bias)!==null)correction=(g.applied_bias>=0?"+":"")+fmt(g.applied_bias,2)+" "+unit(g.variable);
    if(num(g.applied_factor)!==null)correction="×"+fmt(g.applied_factor,3);
    return '<tr>'+
      '<td><b>'+esc(anchorName(g.target))+'</b></td>'+
      '<td>'+esc(variableName(g.variable))+'</td>'+
      '<td>'+esc(leadName(g.lead_bucket))+'</td>'+
      '<td><b>'+n+'/'+min+'</b><div class="progress"><i style="width:'+pct+'%"></i></div></td>'+
      '<td>'+statusPill(g.status)+'</td>'+
      '<td>'+fmt(g.mae,2)+' '+unit(g.variable)+'</td>'+
      '<td>'+fmt(g.mean_error,2)+' '+unit(g.variable)+'</td>'+
      '<td><b>'+esc(correction)+'</b></td>'+
    '</tr>';
  }).join("")||'<tr><td colspan="8">Chưa có forecast archive để ghép case. Hệ thống sẽ tự điền từ các cycle mới.</td></tr>';
}
function saveBlob(name,type,text){
  const url=URL.createObjectURL(new Blob([text],{type}));
  const a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function exportJSON(){
  if(!analyticsData)return;
  saveBlob("jotrip-weather-analytics.json","application/json;charset=utf-8",JSON.stringify(analyticsData,null,2));
}
function exportCSV(){
  if(!analyticsData)return;
  const rows=[["anchor","variable","lead_bucket","sample_count","status","mae","rmse","mean_error","median_error","applied_bias","applied_factor"]];
  (analyticsData.groups||[]).forEach(g=>rows.push([g.target,g.variable,g.lead_bucket,g.sample_count,g.status,g.mae,g.rmse,g.mean_error,g.median_error,g.applied_bias,g.applied_factor]));
  const csv=rows.map(row=>row.map(v=>'"'+String(v??"").replaceAll('"','""')+'"').join(",")).join("\n");
  saveBlob("jotrip-weather-calibration.csv","text/csv;charset=utf-8","\ufeff"+csv);
}
function renderCases(a){
  $("caseRows").innerHTML=(a.recent_cases||[]).slice(0,80).map(c=>'<tr>'+
    '<td>'+esc(localTime(c.valid_time))+'</td>'+
    '<td>'+esc(anchorName(c.target))+'</td>'+
    '<td>'+esc(variableName(c.variable))+'</td>'+
    '<td>'+esc(c.lead_bucket||"-")+'</td>'+
    '<td>'+fmt(c.forecast,2)+' '+unit(c.variable)+'</td>'+
    '<td><b>'+fmt(c.observed,2)+' '+unit(c.variable)+'</b></td>'+
    '<td>'+((num(c.error)||0)>=0?"+":"")+fmt(c.error,2)+' '+unit(c.variable)+'</td>'+
  '</tr>').join("")||'<tr><td colspan="7">Chưa có case forecast → actual đủ điều kiện.</td></tr>';
}
async function loadAnalytics(){
  $("dataState").textContent="LOADING";
  try{
    const [a,c]=await Promise.all([getJSON(ANALYTICS_URL),getJSON(CALIBRATION_URL)]);
    analyticsData=a;
    $("generatedAt").textContent=localTime(a.generated_at);
    renderSummary(a);renderActual(a);renderGroups(a);renderCases(a);
    $("dataState").textContent=(c.status||a.learning_status||"LEARNING")+" · "+(a.matched_cases||0)+" CASES";
  }catch(e){
    $("dataState").textContent="DATA ERROR";
    $("summary").innerHTML='<article class="summary-card"><span>Analytics</span><b>Chưa có dữ liệu</b><small>'+esc(e.message)+'</small></article>';
  }
}
function unlock(){
  $("gate").classList.add("hidden");
  $("analytics").classList.remove("hidden");
  sessionStorage.setItem("jotrip-weather-analytics","1");
  loadAnalytics();
}
$("exportCsv")?.addEventListener("click",exportCSV);
$("exportJson")?.addEventListener("click",exportJSON);
$("gateForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const key=$("accessKey").value;
  const digest=await sha256(key);
  if(digest===KEY_HASH){unlock();return}
  $("gateMsg").textContent="Access key không đúng.";
  $("accessKey").select();
});
if(sessionStorage.getItem("jotrip-weather-analytics")==="1")unlock();
})();