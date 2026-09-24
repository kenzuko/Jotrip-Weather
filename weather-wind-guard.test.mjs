import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {resolve} from "node:path";
const require=createRequire(import.meta.url);
const guard=require(resolve(process.argv[2]||"weather-wind-guard.js"));
const now=Date.parse("2026-09-24T06:45:00+07:00");
const base=()=>{
  const dashboard={
    generated_at:"2026-09-24T06:38:00+07:00",
    snapshot_id:"PQWX_TEST",
    source_cycles:{ECMWF:"2026-09-23T12:00:00Z",ICON:"2026-09-23T18:00:00Z"},
    points:{an_thoi:{hours:[
      {time_iso:"2026-09-24T10:00:00+07:00",wind:29,gust:36,wave:1},
      {time_iso:"2026-09-24T13:00:00+07:00",wind:32,gust:46.3,wave:1.29},
      {time_iso:"2026-09-24T16:00:00+07:00",wind:39,gust:52,wave:1.56},
      {time_iso:"2026-09-24T19:00:00+07:00",wind:23,gust:33,wave:1.1}
    ]}}
  };
  return structuredClone(dashboard);
};
let assertions=0;
const check=(value,expected)=>{assert.equal(value,expected);assertions++};
const valid=guard.deriveAfternoonWatch(base(),now);
check(valid.status,"VALID");check(valid.severity,"alert");
check(valid.events.length,2);check(valid.max_wind_kmh,39);
check(valid.max_gust_kmh,52);check(valid.source,"MODEL_ONLY");
check(valid.events[0].time,"2026-09-24T13:00:00+07:00");
const between=guard.deriveAfternoonWatch(base(),Date.parse("2026-09-24T13:30:00+07:00"));
check(between.status,"STALE"); // Forecast publisher must refresh before afternoon.
const refreshed=base();refreshed.generated_at="2026-09-24T13:24:00+07:00";
const afterStart=guard.deriveAfternoonWatch(refreshed,Date.parse("2026-09-24T13:30:00+07:00"));
check(afterStart.status,"VALID");check(afterStart.events.length,1);
check(afterStart.events[0].wind_kmh,39);
const late=base();late.generated_at="2026-09-24T15:50:00+07:00";
check(guard.deriveAfternoonWatch(late,Date.parse("2026-09-24T16:00:00+07:00")).status,"EXPIRED");
const stale=base();stale.generated_at="2026-09-24T01:00:00+07:00";
check(guard.deriveAfternoonWatch(stale,now).status,"STALE");
const staleCycle=base();staleCycle.source_cycles={ECMWF:"2026-09-22T01:00:00Z",ICON:"2026-09-22T01:00:00Z"};
check(guard.deriveAfternoonWatch(staleCycle,now).reason,"model_cycles_stale");
const inconsistent=base();inconsistent.points.an_thoi.hours[1].gust=25;
check(guard.deriveAfternoonWatch(inconsistent,now).reason,"wind_gust_not_comparable");
const missing=base();missing.points.an_thoi.hours.splice(2,1);
check(guard.deriveAfternoonWatch(missing,now).status,"MISSING");
const noGust=base();noGust.points.an_thoi.hours[1].gust=null;
check(guard.deriveAfternoonWatch(noGust,now).status,"INVALID");
const calm=base();calm.points.an_thoi.hours[1].wind=15;calm.points.an_thoi.hours[1].gust=22;
calm.points.an_thoi.hours[2].wind=19;calm.points.an_thoi.hours[2].gust=27;
check(guard.deriveAfternoonWatch(calm,now).status,"NO_RISK");
check(guard.deriveAfternoonWatch(base(),now,"no_point").status,"MISSING");
check(guard.comparableCurrentGust({value_kmh:32},{value_kmh:27},now),null);
const p={source_id:"VVPQ",point_id:"airport",window_start:"2026-09-24T06:00:00+07:00",
  window_end:"2026-09-24T06:30:00+07:00"};
check(guard.comparableCurrentGust(
  {value_kmh:33,provenance:p},{value_kmh:47,provenance:{...p,source_id:"ECMWF"}},now),null);
check(guard.comparableCurrentGust(
  {value_kmh:33,provenance:p},{value_kmh:47,provenance:p},now)?.gust_kmh,47);
const fc=[{point_id:"an_thoi",valid_time:"2026-09-24T13:00:00+07:00",
  wind_kmh:32,gust_kmh:46,data_class:"MODEL_ONLY"}];
const airport=[{point_id:"airport",valid_time:"2026-09-24T13:00:00+07:00",
  wind_kmh:30,data_class:"ACTUAL"}];
check(guard.auditForecastPairs(fc,airport,1).sample_size,0);
const actual=[{point_id:"an_thoi",valid_time:"2026-09-24T13:00:00+07:00",
  wind_kmh:35,data_class:"ACTUAL"}];
check(guard.auditForecastPairs(fc,actual).status,"INSUFFICIENT_SAMPLE");
check(guard.auditForecastPairs(fc,actual,1).wind_mae_kmh,3);
check(guard.auditForecastPairs(fc,actual,1).gust_mae_kmh,null);
console.log("wind guard PASS - "+assertions+" source, freshness, timeline and audit assertions");
