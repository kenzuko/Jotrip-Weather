/* JoTrip point gust outlook v1.
 * Forecast model gust is NEVER an observed gust. Satellite cloud dynamics
 * can flag convective conditions, not measure a ground-level wind gust.
 * Identical dependency-free source for /weather and the Weather Lab.
 */
(function(root,make){
  "use strict";
  const api=make(root);
  if(typeof module==="object"&&module.exports)module.exports=api;
  if(root)root.JoTripGustOutlook=api;
})(typeof globalThis==="object"?globalThis:null,function(root){
  "use strict";
  const VERSION="2026.09.24.gust-outlook-v1";
  const GUST_WATCH=40,WIND_WATCH=30;
  const n=x=>typeof x==="number"&&Number.isFinite(x)?x:null;
  const ms=x=>{const t=Date.parse(x||"");return Number.isFinite(t)?t:null};
  const fresh=(iso,minutes,now)=>{const t=ms(iso);return t!==null&&(now-t)>=-600000&&(now-t)<=minutes*60000};
  const guard=()=>root?.JoTripWindGuard;
  function haversine(lat,lon,lat2,lon2){
    if([lat,lon,lat2,lon2].some(v=>n(v)===null))return null;
    const rad=Math.PI/180,a=Math.sin((lat2-lat)*rad/2)**2+
      Math.cos(lat*rad)*Math.cos(lat2*rad)*Math.sin((lon2-lon)*rad/2)**2;
    return 12742.0176*Math.asin(Math.sqrt(a));
  }
  function metarGust(groundtruth,now=Date.now()){
    const v=groundtruth?.atmosphere?.vvpq||groundtruth?.actual?.vvpq||{};
    if(v.qc!=="PASS"||v.source_channel!=="METAR"||
       !fresh(v.observed_at,35,now))return null;
    // A gust is only observed when METAR explicitly contains GxxKT.
    const raw=String(v.raw_observation||"");
    const windToken=raw.split(/\s+/).find(token=>
      /^(?:\d{3}|VRB)\d{2,3}G\d{2,3}KT$/.test(token));
    if(!windToken)return null;
    const match=windToken.match(/^(?:\d{3}|VRB)(\d{2,3})G(\d{2,3})KT$/);
    if(!match)return null;
    const wind=Number(match[1])*1.852,gust=Number(match[2])*1.852;
    if(gust<wind||gust>350)return null;
    return {source:"VVPQ_METAR",station:"Sân bay Phú Quốc",
      data_class:"ACTUAL",observed_at:v.observed_at,
      lat:n(v.lat),lon:n(v.lon),wind_kmh:wind,gust_kmh:gust,
      qc:"PASS"};
  }
  function localTimeHour(iso){
    const t=ms(iso);return t===null?"":new Date(t).toLocaleTimeString("vi-VN",{
      timeZone:"Asia/Ho_Chi_Minh",hour:"2-digit",minute:"2-digit",hour12:false});
  }
  function dayKey(now){
    return new Intl.DateTimeFormat("en-CA",{
      timeZone:"Asia/Ho_Chi_Minh",year:"numeric",month:"2-digit",day:"2-digit"
    }).format(new Date(now));
  }
  function pointOutlook({pointId,critical,nowcast,dashboard,groundtruth,now=Date.now()}){
    const point=critical?.points?.[pointId];
    if(!point||!Number.isFinite(now))return {status:"UNAVAILABLE",reason:"point_missing",
      point_id:pointId,forecast:null,observed:null};
    const local=point.local||{},localAt=critical.local_generated_at;
    const localReady=Boolean(local.available&&fresh(localAt,35,now)&&n(local.wind_kmh)!==null);
    const localWind=localReady?n(local.wind_kmh):null;
    const compact=nowcast?.points?.[pointId]||{};
    const backup=point.nowcast||{};
    const satAt=nowcast?.sampled_time||backup.sampled_time;
    const satelliteReady=fresh(satAt,25,now);
    const score=satelliteReady?n(compact.score??compact.convective_signal?.score??backup.convective_score):null;
    const motion=satelliteReady?(compact.cloud_motion||backup.cloud_motion||null):null;
    const track=Boolean(motion?.public_track_usable===true&&motion?.predicted_impact===true&&
      ["MEDIUM","MEDIUM_HIGH","HIGH"].includes(String(motion?.tracking_confidence||"").toUpperCase())&&
      n(motion?.eta_minutes)!==null&&motion.eta_minutes>=0&&motion.eta_minutes<=30);
    const impactMinutes=track?Math.ceil(motion.eta_minutes):null;
    // A forecast model row may supply a timestamped reference only. It MUST NOT
    // become a 5-30 minute quantitative nowcast or a current observation.
    const dashboardReady=guard()?.dashboardUsable(dashboard,now)===true;
    const forecast=dashboardReady?(dashboard.points?.[pointId]?.hours||[])
      .filter(r=>{
        const t=ms(r.time_iso);
        return t!==null&&t>=now-5*60000&&t<=now+180*60000&&
          guard().validForecastFrame(r);
      }).sort((a,b)=>ms(a.time_iso)-ms(b.time_iso))[0]:null;
    const forecastRef=forecast?{
      source:"MODEL_ONLY",valid_time:forecast.time_iso,
      model_wind_kmh:forecast.wind,model_gust_kmh:forecast.gust,
      lead_minutes:Math.max(0,Math.round((ms(forecast.time_iso)-now)/60000)),
      snapshot_id:dashboard.snapshot_id||null,
      cycle:dashboard.source_cycles?.ECMWF||dashboard.source_cycles?.ICON||null
    }:null;
    const stationObs=metarGust(groundtruth,now);
    const ptLat=n(local.reference_lat??point.lat),ptLon=n(local.reference_lon??point.lon);
    const distance=stationObs?haversine(ptLat,ptLon,stationObs.lat,stationObs.lon):null;
    const colocated=distance!==null&&distance<=3?stationObs:null;
    const nearby=distance!==null&&distance<=12?stationObs:null;
    // Never relabel an airport observation as an An Thoi offshore measurement.
    const observed=colocated?{...colocated,point_id:pointId,distance_km:distance}:null;
    const evidence=[];
    if(localReady)evidence.push("gió địa phương ước tính "+Math.round(localWind)+" km/h");
    if(score!==null&&score>=65)evidence.push("mây đối lưu từ Himawari");
    if(track)evidence.push("cụm mây có hướng di chuyển đủ tin cậy, ETA khoảng "+impactMinutes+" phút");
    if(nearby)evidence.push("METAR sân bay cách "+distance.toFixed(1)+" km: giật "+Math.round(nearby.gust_kmh)+" km/h");
    let status="INSUFFICIENT",confidence="LOW",window=null,reason="insufficient_observations";
    if(track&&score>=80&&localWind!==null&&localWind>=WIND_WATCH&&impactMinutes<=15){
      status="ALERT";confidence="MEDIUM";window="0-15 phút";reason="strong_wind_plus_tracked_convection";
    }else if(track&&score>=70){
      status="WATCH";confidence=localWind!==null?"MEDIUM":"LOW";
      window=impactMinutes<=15?"0-15 phút":"15-30 phút";
      reason="tracked_convection_near_point";
    }else if(satelliteReady&&score!==null&&score>=75&&localWind!==null&&localWind>=WIND_WATCH){
      status="WATCH";confidence="LOW";window="0-30 phút";
      reason="strong_background_wind_and_convection_no_reliable_eta";
    }else if(nearby?.gust_kmh>=50&&localWind!==null&&localWind>=WIND_WATCH){
      status="WATCH";confidence="LOW";window="0-30 phút";
      reason="nearby_station_gust_not_at_point";
    }else if(localWind!==null&&localWind>=40){
      status="WATCH";confidence="LOW";reason="local_wind_already_strong_no_gust_eta";
    }else if(localReady&&satelliteReady&&score!==null){
      status="NO_VERIFIED_SIGNAL";confidence="LOW";reason="no_verified_short_term_signal";
    }
    const validity=[localReady?ms(localAt)+35*60000:null,
      satelliteReady?ms(satAt)+25*60000:null].filter(Number.isFinite);
    return {version:VERSION,status,confidence,point_id:pointId,
      name:point.name||pointId,window,reason,track_usable:track,
      impact_eta_minutes:impactMinutes,local_wind_kmh:localWind,
      local_observed_at:localReady?localAt:null,satellite_sampled_at:satelliteReady?satAt:null,
      convective_score:score,evidence,observed,
      nearby_station:nearby?{...nearby,distance_km:distance}:null,
      airport_metar:stationObs,forecast:forecastRef,
      valid_until:validity.length?new Date(Math.min(...validity)).toISOString():null,
      data_class:"SHORT_TERM_RISK_INDICATOR",verification:"NOT_A_GUST_MEASUREMENT"};
  }
  function islandAlerts({critical,nowcast,dashboard,groundtruth,now=Date.now()}){
    const pointIds=(critical?.island_watch_order||Object.keys(critical?.points||{}))
      .filter(id=>id!=="rach_gia"&&critical?.points?.[id]);
    const alerts=[],outlooks={};
    const modelReady=guard()?.dashboardUsable(dashboard,now)===true;
    for(const id of pointIds){
      const outlook=pointOutlook({pointId:id,critical,nowcast,dashboard,groundtruth,now});
      outlooks[id]=outlook;
      if(outlook.status==="WATCH"||outlook.status==="ALERT"){
        alerts.push({
          alert_id:dayKey(now)+"|"+id+"|GUST_0_30",
          point_id:id,point_name:outlook.name,type:"GUST_0_30",
          severity:outlook.status==="ALERT"?"alert":"watch",
          status:"ACTIVE",window:outlook.window,
          valid_times:outlook.window?["0-30_MIN_CONDITIONAL"]:[],
          generated_at:new Date(now).toISOString(),valid_until:outlook.valid_until,
          evidence:outlook.evidence,confidence:outlook.confidence,
          forecast_gust_kmh:null,source:"SATELLITE_LOCAL_WIND_INDICATOR",
          note:"Tín hiệu rủi ro gió giật, KHÔNG phải số đo gió giật hay bảo đảm thời điểm."
        });
      }
      if(!modelReady)continue;
      const selected=(dashboard.points?.[id]?.hours||[]).filter(r=>{
        const t=ms(r.time_iso);
        return t!==null&&t>=now&&t<=now+12*3600000&&
          guard().validForecastFrame(r)&&(r.wind>=30||r.gust>=40);
      }).sort((a,b)=>ms(a.time_iso)-ms(b.time_iso));
      if(!selected.length)continue;
      const gust=Math.max(...selected.map(r=>r.gust));
      alerts.push({
        alert_id:dayKey(now)+"|"+id+"|MODEL_WIND_12H",
        point_id:id,point_name:outlook.name,type:"MODEL_WIND_12H",
        severity:gust>=50||Math.max(...selected.map(r=>r.wind))>=40?"alert":"watch",
        status:"ACTIVE",window:null,
        valid_times:selected.map(r=>r.time_iso),generated_at:dashboard.generated_at,
        valid_until:new Date(ms(selected[selected.length-1].time_iso)+3*3600000).toISOString(),
        evidence:["Mốc mô hình: "+selected.map(r=>localTimeHour(r.time_iso)).join(", ")],
        forecast_gust_kmh:gust,source:"MODEL_ONLY",
        snapshot_id:dashboard.snapshot_id||null,cycle:dashboard.source_cycles?.ECMWF||null,
        note:"Chỉ cảnh báo tại các MỐC dự báo; không suy diễn gió mạnh liên tục giữa hai mốc."
      });
    }
    return {schema_version:"jotrip-weather-alerts-v1",
      generated_at:new Date(now).toISOString(),snapshot_id:dashboard?.snapshot_id||null,
      source_cycles:dashboard?.source_cycles||{},model_valid:modelReady,
      points:outlooks,alerts};
  }
  return Object.freeze({version:VERSION,metarGust,pointOutlook,islandAlerts});
});