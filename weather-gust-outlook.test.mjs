import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {resolve} from "node:path";
const require=createRequire(import.meta.url);
const path=resolve(process.argv[2]||"weather-gust-outlook.js");
const base=path.replace(/weather-gust-outlook\.js$/,"weather-wind-guard.js");
globalThis.JoTripWindGuard=require(base);
const x=require(path);
const now=Date.parse("2026-09-24T08:30:00+07:00");
const dt=s=>Date.parse(s);
let checks=0;
const equal=(a,b)=>{assert.deepEqual(a,b);checks++};
const metar="METAR VVPQ 240100Z 27015G28KT 8000 TSRA FEW015CB 25/24 Q1009";
const ground=(raw=metar,at="2026-09-24T08:15:00+07:00")=>({
 atmosphere:{vvpq:{qc:"PASS",status:"FRESH",source_channel:"METAR",
 lat:10.169,lon:103.995,observed_at:at,wind_speed_kt:15,raw_observation:raw}}
});
const baseCrit=()=>({local_generated_at:"2026-09-24T08:20:00+07:00",
 islanD_tag:"test",island_watch_order:["an_thoi","duong_dong","rach_gia"],
 points:{
  an_thoi:{name:"An Thới",local:{available:true,wind_kmh:32,
    reference_lat:10.0191,reference_lon:104.015},
    nowcast:{sampled_time:"2026-09-24T08:20:00+07:00",convective_score:75}},
  duong_dong:{name:"Dương Đông",local:{available:true,wind_kmh:22,
    reference_lat:10.2172,reference_lon:103.9593}},
  rach_gia:{name:"Rạch Giá",local:{available:true,wind_kmh:17}}
 }});
const sat=(score=75,motion=null,at="2026-09-24T08:20:00+07:00")=>({
 sampled_time:at,status:"POINT_NUMERIC_READY",
 points:{an_thoi:{score,cloud_motion:motion},
 duong_dong:{score:20}}});
const motion=(conf="MEDIUM_HIGH",eta=10)=>({
 public_track_usable:true,predicted_impact:true,
 tracking_confidence:conf,eta_minutes:eta
});
const dash=()=>({snapshot_id:"TEST",generated_at:"2026-09-24T08:20:00+07:00",
 source_cycles:{ECMWF:"2026-09-23T12:00:00Z",ICON:"2026-09-23T18:00:00Z"},
 points:{an_thoi:{hours:[
 {time_iso:"2026-09-24T10:00:00+07:00",wind:31,gust:44,wave:1.2},
 {time_iso:"2026-09-24T13:00:00+07:00",wind:38,gust:51,wave:1.6}
 ]},duong_dong:{hours:[{
 time_iso:"2026-09-24T10:00:00+07:00",wind:20,gust:30,wave:0.8
 }]}}});
const ctx=(overrides={})=>({pointId:"an_thoi",critical:baseCrit(),
 nowcast:sat(),dashboard:dash(),groundtruth:ground(),now,...overrides});
const m=x.metarGust(ground(),now);
equal(m.source,"VVPQ_METAR");equal(m.wind_kmh,27.78);
equal(m.gust_kmh,28*1.852);equal(m.observed_at,"2026-09-24T08:15:00+07:00");
equal(x.metarGust(ground("METAR VVPQ 240100Z 27015KT 8000 -RA"),now),null);
equal(x.metarGust(ground(metar,"2026-09-24T06:00:00+07:00"),now),null);
const bad=ground();bad.atmosphere.vvpq.qc="FAIL";
equal(x.metarGust(bad,now),null);
let p=x.pointOutlook(ctx());
equal(p.status,"WATCH");equal(p.confidence,"LOW");equal(p.window,"0-30 phút");
equal(p.observed,null);equal(p.airport_metar.gust_kmh,28*1.852);
equal(p.nearby_station,null);equal(p.forecast.model_gust_kmh,44);
equal(p.forecast.valid_time,"2026-09-24T10:00:00+07:00");
equal(p.forecast.source,"MODEL_ONLY");equal(p.verification,"NOT_A_GUST_MEASUREMENT");
const tracked=x.pointOutlook(ctx({nowcast:sat(90,motion("MEDIUM_HIGH",8))}));
equal(tracked.status,"ALERT");equal(tracked.window,"0-15 phút");
equal(tracked.confidence,"MEDIUM");equal(tracked.impact_eta_minutes,8);
const lowTrack=x.pointOutlook(ctx({nowcast:sat(90,motion("LOW",8))}));
equal(lowTrack.status,"WATCH");equal(lowTrack.impact_eta_minutes,null);
const stormNoWind=baseCrit();stormNoWind.points.an_thoi.local.wind_kmh=8;
const approach=x.pointOutlook(ctx({critical:stormNoWind,nowcast:sat(85,motion("MEDIUM",20))}));
equal(approach.status,"WATCH");equal(approach.confidence,"MEDIUM");
equal(approach.window,"15-30 phút");
const weak=x.pointOutlook(ctx({critical:stormNoWind,nowcast:sat(10)}));
equal(weak.status,"NO_VERIFIED_SIGNAL");
const stale=x.pointOutlook(ctx({critical:stormNoWind,
 nowcast:sat(95,motion("HIGH",6),"2026-09-24T07:00:00+07:00")}));
equal(stale.status,"INSUFFICIENT");equal(stale.window,null);
const strong=baseCrit();strong.points.an_thoi.local.wind_kmh=43;
const noSatellite=x.pointOutlook(ctx({critical:strong,nowcast:sat(0,null,"2026-09-24T07:00:00+07:00")}));
equal(noSatellite.status,"WATCH");equal(noSatellite.window,null);
const staleDash=dash();staleDash.generated_at="2026-09-23T21:00:00+07:00";
equal(x.pointOutlook(ctx({dashboard:staleDash})).forecast,null);
const badDash=dash();badDash.points.an_thoi.hours[0].gust=22;
equal(x.pointOutlook(ctx({dashboard:badDash})).forecast,null);
const atAirport=baseCrit();atAirport.points.an_thoi.local.reference_lat=10.169;
atAirport.points.an_thoi.local.reference_lon=103.995;
equal(x.pointOutlook(ctx({critical:atAirport})).observed.gust_kmh,28*1.852);
const d=x.pointOutlook(ctx({pointId:"duong_dong"}));
equal(d.observed,null);equal(d.nearby_station?.source,"VVPQ_METAR");
equal(x.pointOutlook(ctx({pointId:"bogus"})).status,"UNAVAILABLE");
const all=x.islandAlerts(ctx({nowcast:sat(90,motion("MEDIUM_HIGH",8))}));
equal(all.alerts.length,3);
equal(all.alerts.filter(a=>a.type==="GUST_0_30").length,1);
equal(all.alerts.filter(a=>a.type==="MODEL_WIND_12H").length,2);
equal(all.alerts.some(a=>a.point_id==="rach_gia"),false);
equal(all.alerts.find(a=>a.type==="GUST_0_30").forecast_gust_kmh,null);
equal(all.alerts.find(a=>a.point_id==="an_thoi"&&a.type==="MODEL_WIND_12H").valid_times.length,2);
console.log("PASS: "+checks+" gust nowcast, METAR, freshness, model and all-island alert checks");
