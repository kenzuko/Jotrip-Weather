import assert from "node:assert/strict";
import {planObservationOverlay} from "../scripts/weather-observation-overlay.mjs";
const NOW=Date.parse("2026-09-30T09:45:00Z");
const old="2026-09-30T08:00:00Z";
const latest="2026-09-30T09:20:00Z";
function fixtures(){
 const compact={status:"POINT_NUMERIC_READY",generated_at:"2026-09-30T09:25:00Z",
  sampled_time:latest,source:"JMA_HIMAWARI9_VIA_NOAA_OPEN_DATA",
  points:{duong_dong:{score:22}}};
 const cloud={status:"POINT_NUMERIC_READY",generated_at:"2026-09-30T09:25:00Z",
  sampled_time:latest,source:"JMA_HIMAWARI9_VIA_NOAA_OPEN_DATA",
  source_type:"ACTUAL_SATELLITE",observation_resolution:"OBSERVED_SATELLITE_PIXELS",
  spatial:{status:"READY",bounds:{south:9,north:11,west:102,east:105},
   display_grid_deg:0.075,sampling_method:"DIRECT_SATELLITE",
   frames:[{sampled_time:latest,cells:[{lat:10,lon:104,convective_score:22,
    extraneous:"omit-from-public-compact"}]}]}};
 const manifest={schema_version:"weather-runtime-manifest-v1",
  status:"READY",generated_at:old,pipeline_version:"JOTRIP_WEATHER_RUNTIME_V1",
  policy:{frontend_source:"SAME_ORIGIN_CANONICAL_ONLY",
   browser_fallback:"DISABLED",legacy_fallback:"DISABLED"},
  files:{cloud:"/data/weather-runtime/cloud.json",
   forecast:"/data/weather-runtime/forecast.json"},
  source_times:{cloud_sampled_time:old,forecast_run_time:"2026-09-30T00:00:00Z",
   marine_sampled_time:"2026-09-30T08:00:00Z"}};
 return {published:{
  manifest,cloud:{sampled_time:old},compact:{sampled_time:old}
 },upstream:{cloud,compact}};
}
{
 const {published,upstream}=fixtures();
 const result=planObservationOverlay(published,upstream,NOW);
 assert.equal(result.status,"UPDATED");
 assert.equal(Object.keys(result.files).length,7);
 const m=result.files["data/weather-runtime/manifest.json"];
 assert.equal(m.source_times.cloud_sampled_time,latest);
 assert.equal(m.source_times.compact_sampled_time,latest);
 assert.equal(m.source_times.forecast_run_time,"2026-09-30T00:00:00Z");
 assert.equal(m.source_times.marine_sampled_time,"2026-09-30T08:00:00Z");
 assert.deepEqual(m.files,published.manifest.files);
 assert.equal(m.observation_overlay.forecast_unchanged,true);
 assert(!Object.keys(result.files).some(name=>
  /forecast|groundtruth|current|critical|marine|local-now/.test(name)));
 const cell=result.files["data/weather-runtime/cloud.json"].spatial.frames[0].cells[0];
 assert.equal(cell.convective_score,22);
 assert.equal(Object.hasOwn(cell,"extraneous"),false);
 assert.equal(upstream.cloud.spatial.frames[0].cells[0].extraneous,
  "omit-from-public-compact","upstream input must remain immutable");
 const next=planObservationOverlay({
  manifest:m,cloud:result.files["data/weather-runtime/cloud.json"],
  compact:result.files["data/weather-runtime/compact.json"]
 },upstream,NOW);
 assert.equal(next.status,"UNCHANGED");
 assert.equal(next.updated,false);
}
{
 const {published,upstream}=fixtures();
 upstream.cloud.sampled_time="2026-09-30T08:20:00Z";
 upstream.cloud.spatial.frames[0].sampled_time=upstream.cloud.sampled_time;
 upstream.compact.sampled_time=upstream.cloud.sampled_time;
 assert.equal(planObservationOverlay(published,upstream,NOW).status,"STALE_SOURCE",
  "old source must not be called fresh");
}
{
 const {published,upstream}=fixtures();
 published.manifest.source_times.cloud_sampled_time="2026-09-30T09:30:00Z";
 assert.equal(planObservationOverlay(published,upstream,NOW).status,"UNCHANGED",
  "out-of-order updates must never roll back observation timestamps");
}
{
 const {published,upstream}=fixtures();
 upstream.compact.sampled_time="2026-09-30T09:10:00Z";
 assert.throws(()=>planObservationOverlay(published,upstream,NOW),/match/);
}
{
 const {published,upstream}=fixtures();
 upstream.cloud.source="MODEL_FORECAST";
 assert.throws(()=>planObservationOverlay(published,upstream,NOW),/verified Himawari/);
}
{
 const {published,upstream}=fixtures();
 upstream.cloud.spatial.frames[0].cells=[];
 assert.throws(()=>planObservationOverlay(published,upstream,NOW),/last frame/);
}
{
 const {published,upstream}=fixtures();
 published.manifest.policy.frontend_source="EXTERNAL";
 assert.throws(()=>planObservationOverlay(published,upstream,NOW),/manifest contract/);
}
console.log("PASS observation overlay: 8 fail-closed and monotonicity scenarios");
