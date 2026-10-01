(function(root,factory){
  "use strict";
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  root.JoTripWeatherV3Preview=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";
  const num=v=>{
    if((typeof v!=="number"&&typeof v!=="string")||(typeof v==="string"&&!v.trim()))return null;
    const n=Number(v); return Number.isFinite(n)?n:null;
  };
  const clean=s=>String(s||"").trim();

  function validContract(payload){
    return !!payload && payload.schema_version==="weather-v3-ui-preview-v1";
  }

  function readiness(payload){
    if(!validContract(payload))return {known:false,publicReady:false,reason:"INVALID_OR_MISSING_CONTRACT"};
    const publicReady=payload.public_ui_enabled===true && payload.status==="PUBLIC_READY";
    return {
      known:true,
      publicReady,
      status:payload.status||null,
      publicAuthority:payload.public_authority||null,
      reason:publicReady?null:"V3_PUBLIC_GATE_CLOSED"
    };
  }

  function radarSummary(point){
    const radar=point?.radar;
    if(!radar)return null;
    const max15=num(radar.max_dbz_15km), max30=num(radar.max_dbz_30km);
    const strongest=max15!==null?max15:max30;
    const coverage=clean(radar.coverage)||"UNKNOWN";
    let headline="Radar đang theo dõi khu vực này.";
    if(strongest!==null && strongest>=35) headline="Radar đang ghi nhận vùng phản hồi mạnh gần khu vực này.";
    else if(strongest!==null && strongest>=20) headline="Radar đang ghi nhận vùng phản hồi mưa gần khu vực này.";
    else if(strongest!==null && strongest>0) headline="Radar đang ghi nhận tín hiệu yếu gần khu vực này.";
    else if(["LIMITED","NO_VALID_PIXELS","UNKNOWN"].includes(coverage))
      headline="Radar chưa đủ phủ để kết luận tại khu vực này.";
    else headline="Radar chưa ghi nhận phản hồi đáng kể gần khu vực này.";

    return {
      headline,
      coverage,
      observedAt:radar.observed_at||null,
      maxDbz15km:max15,
      maxDbz30km:max30,
      negativeEvidenceIsWeak:radar.negative_evidence_is_weak===true,
      evidenceClass:"REMOTE_OBSERVED"
    };
  }

  function nowcastSummary(point){
    const rows=Array.isArray(point?.nowcast?.candidates)?point.nowcast.candidates:[];
    const usable=rows.filter(x=>x&&x.public_usable===true&&num(x.eta_minutes)!==null)
      .sort((a,b)=>num(a.eta_minutes)-num(b.eta_minutes));
    if(!usable.length)return null;
    const first=usable[0], eta=Math.max(0,Math.round(num(first.eta_minutes)));
    let detail;
    if(eta<=30)detail="Có vùng mưa cần để ý trong khoảng 30 phút tới.";
    else if(eta<=60)detail="Có vùng mưa cần để ý trong khoảng 30-60 phút tới.";
    else detail="Có tín hiệu mưa cần theo dõi trong khoảng 1-2 giờ tới.";
    return {
      headline:"Theo dõi mưa đang tiến gần",
      detail,
      etaMinutes:eta,
      window:first.window||null,
      evidenceClass:"DERIVED_NOWCAST",
      publicUsable:true
    };
  }

  function internalPointView(payload,pointId){
    if(!validContract(payload))return null;
    const point=payload.points?.[pointId];
    if(!point)return null;
    return {
      mode:"INTERNAL_PREVIEW",
      gate:readiness(payload),
      actualRain:point.actual_rain||null,
      radar:radarSummary(point),
      satellite:point.satellite||null,
      nowcastCandidates:point.nowcast?.candidates||[],
      publicNowcast:nowcastSummary(point)
    };
  }

  function publicPointView(payload,pointId){
    const gate=readiness(payload);
    if(!gate.publicReady)return null;
    const point=payload.points?.[pointId];
    if(!point)return null;
    return {
      mode:"PUBLIC",
      actualRain:point.actual_rain||null,
      radar:radarSummary(point),
      nowcast:nowcastSummary(point)
    };
  }

  return {readiness,radarSummary,nowcastSummary,internalPointView,publicPointView};
});
