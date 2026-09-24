/* Durable warning lifecycle - never equate data loss with a resolved hazard.
 * Bundled by Worker, and mirrored by the Weather Lab's GitHub Action.
 * Pure and dependency-free; the caller supplies validated current alerts.
 */
(function(root,make){
 "use strict";
 const api=make();
 if(typeof module==="object"&&module.exports)module.exports=api;
 if(root)root.JoTripAlertLedger=api;
})(typeof globalThis==="object"?globalThis:null,function(){
 "use strict";
 const at=t=>{const n=Date.parse(t||"");return Number.isFinite(n)?n:null};
 const num=x=>typeof x==="number"&&Number.isFinite(x)?x:null;
 function signature(alert){
   return JSON.stringify({
     type:alert.type,source:alert.source,severity:alert.severity,
     window:alert.window||null,
     times:(alert.valid_times||[]).filter(t=>t!=="0-30_MIN_CONDITIONAL"),
     // Reduce noisy rewrites without concealing changes to the safety class.
     peak_gust_bucket:num(alert.forecast_gust_kmh)===null?null:
       Math.round(alert.forecast_gust_kmh/5)*5,
     confidence:alert.confidence||null
   });
 }
 function nextState(previous,publication,now=Date.now()){
   const published=new Map((publication?.alerts||[]).map(a=>[a.alert_id,a]));
   const prev=new Map((previous||[]).map(a=>[a.alert_id,a]));
   const active=[],transitions=[];
   const outlooks=publication?.points||{};
   const timestamp=new Date(now).toISOString();
   const today=timestamp.slice(0,10);
   for(const a of published.values()){
     if(a.status!=="ACTIVE")continue;
     const prevState=prev.get(a.alert_id);
     const sig=signature(a);
     const changed=!prevState||prevState.status!=="ACTIVE"||prevState.signature!==sig;
     const state={alert_id:a.alert_id,point_id:a.point_id,type:a.type,
       status:"ACTIVE",severity:a.severity,signature:sig,
       latest_json:JSON.stringify(a),
       first_seen_at:prevState?.first_seen_at||timestamp,
       last_seen_at:timestamp,updated_at:changed?timestamp:(prevState.updated_at||timestamp),
       valid_until:a.valid_until||null};
     active.push(state);
     if(changed)transitions.push({
       event_id:a.alert_id+"@"+timestamp,
       alert_id:a.alert_id,changed_at:timestamp,
       previous_status:prevState?.status||null,new_status:"ACTIVE",
       kind:prevState?"UPDATED":"ISSUED",alert:a
     });
     prev.delete(a.alert_id);
   }
   for(const old of prev.values()){
     if(!["ACTIVE","UNKNOWN"].includes(old.status))continue;
     const expired=at(old.valid_until)!==null&&at(old.valid_until)<=now;
     const outlook=outlooks[old.point_id]||{};
     // Healthy source-gated no-signal may resolve a short-term warning;
     // missing/stale sources may only make it UNKNOWN.
     const evidenceOk=old.type==="MODEL_WIND_12H"?
       publication?.model_valid===true:
       outlook.status==="NO_VERIFIED_SIGNAL";
     const status=expired?"EXPIRED":evidenceOk?"RESOLVED":"UNKNOWN";
     const changed=status!==old.status;
     const state={...old,status,last_seen_at:timestamp,
       updated_at:changed?timestamp:old.updated_at};
     active.push(state);
     if(changed)transitions.push({
       event_id:old.alert_id+"@"+timestamp,
       alert_id:old.alert_id,changed_at:timestamp,
       previous_status:old.status,new_status:status,
       kind:status,alert:JSON.parse(old.latest_json||"{}")
     });
   }
   return {schema_version:"jotrip-weather-alert-ledger-v1",date:today,
     timestamp,states:active,transitions};
 }
 function snapshot(dashboard,now=Date.now()){
   if(!dashboard?.points||!dashboard.generated_at)return null;
   const pts={};
   for(const [id,p] of Object.entries(dashboard.points)){
     const rows=(p.hours||[]).filter(r=>{
       const t=at(r.time_iso);
       return t!==null&&t>=now-6*3600000&&t<=now+72*3600000;
     }).map(r=>({
       valid_time:r.time_iso,wind_kmh:num(r.wind),gust_kmh:num(r.gust),
       rain_mm:num(r.rain),wave_hs_m:num(r.wave),wave_reference:r.wave_reference||null,
       data_class:"MODEL_ONLY"
     }));
     if(rows.length)pts[id]={reference_point:p.reference_point||null,hours:rows};
   }
   const id=(dashboard.snapshot_id||dashboard.generated_at);
   return {schema_version:"jotrip-weather-forecast-snapshot-v1",
     snapshot_id:id,generated_at:dashboard.generated_at,
     captured_at:new Date(now).toISOString(),
     source_cycles:dashboard.source_cycles||{},points:pts,
     note:"Forecast baseline archived before verifying against same-location observations; publisher time does not change model cycle."};
 }
 return Object.freeze({nextState,signature,snapshot});
});