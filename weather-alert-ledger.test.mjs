import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {resolve} from "node:path";
const require=createRequire(import.meta.url),ledger=require(resolve(process.argv[2]||"weather-alert-ledger.js"));
const clock=Date.parse("2026-09-24T08:30:00+07:00"),iso=n=>new Date(n).toISOString();
let checks=0;const eq=(a,b)=>{assert.deepEqual(a,b);checks++};
const model={alert_id:"2026-09-24|an_thoi|MODEL_WIND_12H",
 point_id:"an_thoi",type:"MODEL_WIND_12H",source:"MODEL_ONLY",
 severity:"watch",status:"ACTIVE",valid_times:["2026-09-24T10:00:00+07:00"],
 forecast_gust_kmh:44,valid_until:iso(clock+6*3600000),evidence:[]};
const quick={alert_id:"2026-09-24|an_thoi|GUST_0_30",
 point_id:"an_thoi",type:"GUST_0_30",source:"SATELLITE_LOCAL_WIND_INDICATOR",
 severity:"watch",status:"ACTIVE",window:"0-30 phút",
 valid_times:["0-30_MIN_CONDITIONAL"],forecast_gust_kmh:null,
 valid_until:iso(clock+25*60000)};
const live=(alerts,points={an_thoi:{status:"WATCH"}},model_valid=true)=>
 ({alerts,points,model_valid});
const issued=ledger.nextState([],live([model,quick]),clock);
eq(issued.states.length,2);eq(issued.transitions.length,2);
eq(issued.transitions[0].kind,"ISSUED");
const repeat=ledger.nextState(issued.states,live([model,quick]),clock+60000);
eq(repeat.transitions.length,0);eq(repeat.states[0].updated_at,issued.states[0].updated_at);
const higher={...model,severity:"alert",forecast_gust_kmh:52};
const updated=ledger.nextState(repeat.states,live([higher,quick]),clock+120000);
eq(updated.transitions.length,1);eq(updated.transitions[0].kind,"UPDATED");
eq(updated.states[0].severity,"alert");
const missing=ledger.nextState(updated.states,live([],{an_thoi:{status:"INSUFFICIENT"}},false),clock+4*60000);
eq(missing.states.filter(s=>s.status==="UNKNOWN").length,2);
eq(missing.transitions.every(s=>s.new_status==="UNKNOWN"),true);
const stillUnknown=ledger.nextState(missing.states,live([],{an_thoi:{status:"INSUFFICIENT"}},false),clock+5*60000);
eq(stillUnknown.transitions.length,0);
const restored=ledger.nextState(stillUnknown.states,live([higher,quick]),clock+7*60000);
eq(restored.transitions.length,2);
const stableModel=ledger.nextState(restored.states,live([], {an_thoi:{status:"NO_VERIFIED_SIGNAL"}},true),clock+8*60000);
eq(stableModel.states.filter(s=>s.status==="RESOLVED").length,2);
const longGap=ledger.nextState(updated.states,live([],{an_thoi:{status:"INSUFFICIENT"}},false),
 clock+7*3600000);
eq(longGap.states.filter(s=>s.status==="EXPIRED").length,2);
const sameGust={...model,forecast_gust_kmh:46};
eq(ledger.signature(model),ledger.signature(sameGust));
const snap=ledger.snapshot({
 snapshot_id:"TEST_123",generated_at:iso(clock-300000),
 source_cycles:{ECMWF:iso(clock-10*3600000)},
 points:{an_thoi:{reference_point:{lat:10.0191,lon:104.015},
 hours:[{time_iso:"2026-09-24T10:00:00+07:00",wind:31,gust:44,
 rain:9,wave:1.3},{time_iso:"2026-09-27T13:00:00+07:00",wind:22,gust:30}]}}
},clock);
eq(snap.points.an_thoi.hours.length,1);
eq(snap.points.an_thoi.hours[0].data_class,"MODEL_ONLY");
eq(ledger.snapshot({},clock),null);
console.log("PASS: "+checks+" immutable-forecast and warning-lifecycle checks");
