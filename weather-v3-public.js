(()=>{
"use strict";

const CRITICAL="/data/critical.json";
const NOWCAST="/data/nowcast-compact.json";
const REFRESH_MS=5*60*1000;
const POINT_NAMES={
  duong_dong:"Dương Đông",an_thoi:"An Thới",ganh_dau:"Gành Dầu",cua_can:"Cửa Cạn",
  bai_thom:"Bãi Thơm",ham_ninh:"Hàm Ninh",bai_sao:"Bãi Sao",rach_gia:"Rạch Giá"
};

const $=id=>document.getElementById(id);
let critical=null;
let nowcast=null;
let refreshTimer=null;
let lastPoint=null;

function currentPoint(){
  return document.querySelector("#pointTabs button.active")?.dataset?.point||
    document.body?.dataset?.point||"duong_dong";
}
function clock(iso){
  const d=new Date(iso||"");
  if(!Number.isFinite(d.getTime()))return null;
  return d.toLocaleTimeString("vi-VN",{timeZone:"Asia/Ho_Chi_Minh",hour:"2-digit",minute:"2-digit",hour12:false});
}
async function readJSON(url){
  const sep=url.includes("?")?"&":"?";
  const r=await fetch(url+sep+"v="+Date.now(),{cache:"no-store"});
  if(!r.ok)throw new Error("HTTP "+r.status+" "+url);
  return r.json();
}
function evidenceLabel(kind){
  const k=String(kind||"").toUpperCase();
  if(k==="ACTUAL")return "QUAN TRẮC";
  if(k==="DERIVED_NOWCAST")return "NOWCAST";
  if(k==="REMOTE_OBSERVED")return "VỆ TINH";
  return "CHƯA XÁC NHẬN";
}
function stateClass(state){
  const s=String(state||"");
  if(/ACTUAL_RAIN|THUNDER/.test(s))return "rain";
  if(/APPROACHING|CONVECTIVE_WATCH/.test(s))return "watch";
  if(/STALE/.test(s))return "stale";
  return "neutral";
}
function render(){
  const panel=$("v3ObservationPanel");
  if(!panel||!globalThis.JoTripWeatherV3Public)return;

  const pointId=currentPoint();
  const view=globalThis.JoTripWeatherV3Public.pointView(critical,nowcast,pointId);
  if(!view){panel.hidden=true;return}

  const pointName=POINT_NAMES[pointId]||pointId;
  if($("v3PointLabel"))$("v3PointLabel").textContent="Theo "+pointName;

  const now=view.now,soon=view.soon;
  const nowCard=$("v3NowCard"),soonCard=$("v3SoonCard");
  if(nowCard)nowCard.className="v3-signal-card "+stateClass(now.state);
  if(soonCard)soonCard.className="v3-signal-card "+stateClass(soon.state);

  if($("v3NowEvidence"))$("v3NowEvidence").textContent=evidenceLabel(now.evidenceClass);
  if($("v3NowTitle"))$("v3NowTitle").textContent=now.headline;
  if($("v3NowDetail"))$("v3NowDetail").textContent=now.detail;
  if($("v3NowTime"))$("v3NowTime").textContent=now.observedAt?("Cập nhật "+clock(now.observedAt)):"Không có mẫu mưa trực tiếp mới";

  if($("v3SoonEvidence"))$("v3SoonEvidence").textContent=evidenceLabel(soon.evidenceClass);
  if($("v3SoonTitle"))$("v3SoonTitle").textContent=soon.headline;
  if($("v3SoonDetail"))$("v3SoonDetail").textContent=soon.detail;
  if($("v3SoonTime"))$("v3SoonTime").textContent=soon.observedAt?("Ảnh vệ tinh "+clock(soon.observedAt)):"Đang chờ dữ liệu mới";

  panel.dataset.point=pointId;
  panel.hidden=false;
  lastPoint=pointId;
}

async function refresh(){
  try{
    const [c,n]=await Promise.allSettled([readJSON(CRITICAL),readJSON(NOWCAST)]);
    if(c.status==="fulfilled")critical=c.value;
    if(n.status==="fulfilled")nowcast=n.value;
    if(!critical&&!nowcast)throw new Error("V3 beta sources unavailable");
    render();
    const state=$("v3BetaState");
    if(state)state.textContent="BETA";
  }catch(err){
    console.warn("[Weather V3 Beta] giữ nguyên lớp V2 vì không đọc được dữ liệu V3 beta.",err);
    const panel=$("v3ObservationPanel");
    if(panel)panel.hidden=true;
  }
}

function installPointWatch(){
  const tabs=$("pointTabs");
  if(!tabs)return;
  tabs.addEventListener("click",()=>setTimeout(render,0));
  const observer=new MutationObserver(()=>{
    const p=currentPoint();
    if(p!==lastPoint)render();
  });
  observer.observe(tabs,{subtree:true,attributes:true,attributeFilter:["class"]});
}

function boot(){
  if(!$("v3ObservationPanel"))return;
  installPointWatch();
  refresh();
  refreshTimer=setInterval(()=>{
    if(document.visibilityState==="visible")refresh();
  },REFRESH_MS);
  document.addEventListener("visibilitychange",()=>{
    if(document.visibilityState==="visible")refresh();
  });
}

if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});
else boot();
})();
