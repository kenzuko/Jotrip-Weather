/* JoTrip Weather wind contract v1 - shared verbatim by both weather surfaces.
 * Model wind and model gust are forecast-only. Never infer a measured gust.
 * This module is deliberately dependency-free so both sites can audit it.
 */
(function(root, make){
  "use strict";
  const api=make();
  if(typeof module==="object"&&module.exports) module.exports=api;
  if(root)root.JoTripWindGuard=api;
})(typeof globalThis==="object"?globalThis:null,function(){
  "use strict";
  const TZ="Asia/Ho_Chi_Minh";
  const MS_HOUR=3600000;
  const fmt=new Intl.DateTimeFormat("en-GB",{
    timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit",
    hour:"2-digit",minute:"2-digit",hourCycle:"h23"
  });
  const num=value=>typeof value==="number"&&Number.isFinite(value)?value:null;
  const timestamp=value=>{
    const n=Date.parse(value||"");
    return Number.isFinite(n)?n:null;
  };
  function localParts(value){
    const ms=typeof value==="number"?value:timestamp(value);
    if(ms===null)return null;
    const parts=Object.fromEntries(fmt.formatToParts(new Date(ms))
      .filter(p=>p.type!=="literal").map(p=>[p.type,p.value]));
    return {date:parts.year+"-"+parts.month+"-"+parts.day,
      hour:Number(parts.hour),minute:Number(parts.minute)};
  }
  function ageHours(iso,now){
    const t=timestamp(iso);
    return t===null?Infinity:(now-t)/MS_HOUR;
  }
  function validFrame(row){
    const wind=num(row?.wind),gust=num(row?.gust),wave=num(row?.wave);
    const t=timestamp(row?.time_iso);
    // Both speeds must be from the SAME model row and the SAME forecast valid time.
    return t!==null&&wind!==null&&gust!==null&&wind>=0&&
      gust>=wind&&wind<=250&&gust<=350&&
      (wave===null||(wave>=0&&wave<=30));
  }
  function deriveAfternoonWatch(dashboard,now=Date.now(),pointId="an_thoi"){
    const invalid=(status,reason)=>({status,reason,events:[]});
    if(!Number.isFinite(now))return invalid("INVALID","invalid_now");
    // The afternoon event must disappear after 16:00 even if the model stalled.
    const hour=localParts(now)?.hour;
    if(hour>=16)return invalid("EXPIRED","forecast_window_finished");
    if(!dashboard?.points?.[pointId])return invalid("MISSING","point_missing");
    const snapshotAge=ageHours(dashboard.generated_at,now);
    if(snapshotAge<-.17||snapshotAge>2.5)return invalid("STALE","forecast_snapshot_stale");
    // A recent publisher timestamp alone does not make old forecast runs fresh.
    const cycles=dashboard.source_cycles||{};
    const primary=["ECMWF","ICON"].some(k=>{
      const a=ageHours(cycles[k],now);
      return a>=-.5&&a<=30;
    });
    if(!primary)return invalid("STALE","model_cycles_stale");
    const today=localParts(now)?.date;
    const rows=dashboard.points[pointId].hours||[];
    const atHour=h=>rows.find(r=>{
      const p=localParts(r.time_iso);
      return p?.date===today&&p.hour===h&&p.minute===0;
    });
    const expected=[13,16].map(atHour);
    if(expected.some(row=>!row))return invalid("MISSING","forecast_window_incomplete");
    if(expected.some(row=>!validFrame(row)))return invalid("INVALID","wind_gust_not_comparable");
    if(timestamp(expected[0].time_iso)>=timestamp(expected[1].time_iso))
      return invalid("INVALID","time_order");
    if(now>=timestamp(expected[1].time_iso))
      return invalid("EXPIRED","forecast_window_finished");
    const upcoming=expected.filter(r=>timestamp(r.time_iso)>=now-10*60000);
    const strong=upcoming.filter(r=>r.wind>=30||r.gust>=40);
    if(!strong.length)return invalid("NO_RISK","below_watch_threshold");
    const peakWind=Math.max(...strong.map(r=>r.wind));
    const peakGust=Math.max(...strong.map(r=>r.gust));
    const severity=peakWind>=40||peakGust>=50?"alert":"watch";
    const sourceCycles=Object.fromEntries(Object.entries(cycles)
      .filter(([,v])=>timestamp(v)!==null));
    return {status:"VALID",reason:null,pointId,severity,
      snapshot_id:dashboard.snapshot_id||null,
      generated_at:dashboard.generated_at,
      source_cycles:sourceCycles,
      valid_times:upcoming.map(r=>r.time_iso),
      first_risk_time:strong[0].time_iso,
      last_risk_time:strong[strong.length-1].time_iso,
      // Show discrete model slots, NEVER assert continuous wind between samples.
      events:upcoming.map(r=>({
        time:r.time_iso,wind_kmh:r.wind,gust_kmh:r.gust,
        wave_hs_m:num(r.wave),risk:r.wind>=30||r.gust>=40
      })),
      max_wind_kmh:peakWind,max_gust_kmh:peakGust,
      source:"MODEL_ONLY",verification:"NOT_OBSERVED"};
  }
  function comparableCurrentGust(wind,gust,now=Date.now()){
    // Reserved for a future true gust observation: fail closed without provenance.
    const w=num(wind?.value_kmh),g=num(gust?.value_kmh);
    if(w===null||g===null||w<0||g<w)return null;
    const p=wind?.provenance,q=gust?.provenance;
    if(!p||!q||!p.source_id||!p.point_id||!p.window_start||
       !p.window_end||!q.window_start||!q.window_end)return null;
    if(p.source_id!==q.source_id||p.point_id!==q.point_id||
       p.window_start!==q.window_start||p.window_end!==q.window_end)return null;
    const age=ageHours(p.window_end,now),gustAge=ageHours(q.window_end,now);
    if(age<0||age>.5||gustAge<0||gustAge>.5)return null;
    return {wind_kmh:w,gust_kmh:g,provenance:p};
  }
  function auditForecastPairs(forecasts,observations,minSamples=20){
    // Never mix airport observations with offshore An Thoi forecasts.
    const obsByKey=new Map();
    for(const o of observations||[]){
      if(!o?.point_id||timestamp(o.valid_time)===null||
         num(o.wind_kmh)===null||o.data_class!=="ACTUAL")continue;
      obsByKey.set(o.point_id+"|"+timestamp(o.valid_time),o);
    }
    const pairs=[];
    for(const f of forecasts||[]){
      if(!f?.point_id||f.data_class!=="MODEL_ONLY"||
         timestamp(f.valid_time)===null||num(f.wind_kmh)===null)continue;
      const o=obsByKey.get(f.point_id+"|"+timestamp(f.valid_time));
      if(!o)continue;
      pairs.push({point_id:f.point_id,valid_time:f.valid_time,
        wind_error_kmh:f.wind_kmh-o.wind_kmh,
        gust_error_kmh:num(f.gust_kmh)!==null&&num(o.gust_kmh)!==null?
          f.gust_kmh-o.gust_kmh:null});
    }
    const n=pairs.length;
    const wind_mae_kmh=n?pairs.reduce((a,p)=>a+Math.abs(p.wind_error_kmh),0)/n:null;
    const gust=pairs.filter(p=>p.gust_error_kmh!==null);
    return {status:n>=minSamples?"EVALUABLE":"INSUFFICIENT_SAMPLE",
      sample_size:n,required_samples:minSamples,
      wind_mae_kmh:n>=minSamples?wind_mae_kmh:null,
      gust_sample_size:gust.length,
      gust_mae_kmh:gust.length>=minSamples?
        gust.reduce((a,p)=>a+Math.abs(p.gust_error_kmh),0)/gust.length:null,
      pairs};
  }
  return Object.freeze({version:"2026.09.24.wind-qc-v1",
    deriveAfternoonWatch,comparableCurrentGust,auditForecastPairs});
});
