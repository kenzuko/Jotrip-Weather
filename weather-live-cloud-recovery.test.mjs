// Smoke test the isolated read-only Himawari recovery gateway without network.
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const source=await readFile("cloudflare/weather-fresh-worker.js","utf8");
const app=(await import("data:text/javascript;charset=utf-8,"+encodeURIComponent(source))).default;
const sampled=new Date(Date.now()-18*60000).toISOString();
const generated=new Date().toISOString();
const cells=[{lat:10.2,lon:104.0,convective_score:67,convective_level:"WATCH",cloud_top_cold_c:-58,cloud_top_median_c:-30,cloud_top_high_m:12700,cloud_top_median_m:8500,cooling_c_per_20m_proxy:1.2,internal_do_not_publish:"secret"}];
const full={
  status:"POINT_NUMERIC_READY",generated_at:generated,sampled_time:sampled,
  source:"JMA_HIMAWARI9_VIA_NOAA_OPEN_DATA",source_type:"OBSERVED_SATELLITE",
  observation_resolution:"~2 km",points:{duong_dong:{}},
  spatial:{status:"READY",bounds:{south:9,north:11,west:102,east:105},display_grid_deg:0.075,sampling_method:"SOURCE_GRID",frames:Array.from({length:8},(_,i)=>({sampled_time:new Date(Date.now()-(80-i*10)*60000).toISOString(),cells}))}
};
const pending=[];
const ctx={waitUntil(p){pending.push(p)}};
const store=new Map();
globalThis.caches={default:{
  async match(request){return store.get(request.url)?.clone()||null},
  async put(request,response){store.set(request.url,response.clone())}
}};
let upstreamCalls=0;
globalThis.fetch=async url=>{
  upstreamCalls++;
  assert.match(String(url),/weather-nowcast\/latest\.json/);
  return new Response(JSON.stringify(full),{status:200,headers:{"content-type":"application/json"}});
};

const url="https://jotrip-weather-fresh.test/cloud.json";
const first=await app.fetch(new Request(url),{},ctx);
assert.equal(first.status,200);
assert.equal(first.headers.get("access-control-allow-origin"),"https://weather.openphuquoc.com");
assert.equal(first.headers.get("x-jotrip-edge"),"MISS");
assert.equal(first.headers.get("x-jotrip-source-at"),sampled);
const firstBody=await first.json();
assert.equal(firstBody.sampled_time,sampled);
assert.equal(firstBody.spatial.frames.length,6);
assert.equal(firstBody.spatial.frames[0].cells[0].convective_score,67);
assert.equal("internal_do_not_publish" in firstBody.spatial.frames[0].cells[0],false);
assert.equal("points" in firstBody,false);
await Promise.all(pending);
const second=await app.fetch(new Request(url),{},ctx);
assert.equal(second.headers.get("x-jotrip-edge"),"HIT");
assert.equal(upstreamCalls,1);
const secondBody=await second.json();
assert.equal(secondBody.sampled_time,sampled);
const unknown=await app.fetch(new Request("https://jotrip-weather-fresh.test/unknown.json"),{},ctx);
assert.equal(unknown.status,404);

// Only a validated observed cloud payload is allowed through the gateway.
store.clear();
globalThis.fetch=async()=>new Response(JSON.stringify({...full,status:"UNAVAILABLE"}),{status:200});
const invalid=await app.fetch(new Request(url),{},ctx);
assert.equal(invalid.status,503);
console.log("Weather live cloud gateway PASS: source contract, 6 frames, CORS, age, cache and unavailable gate");
