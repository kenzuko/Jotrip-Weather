// Regression tests for the scheduled observation-only Himawari dispatch.
// No network, no real GitHub Actions, no secret values. Keep the model mirror
// and observation publisher independent even when the groundtruth is current.
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const source=await readFile("cloudflare/weather-fresh-worker.js","utf8");
const app=(await import("data:text/javascript;charset=utf-8,"+encodeURIComponent(source))).default;
const mins=n=>new Date(Date.now()-n*60_000).toISOString();
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json"}});
const cloud={status:"POINT_NUMERIC_READY",source:"JMA_HIMAWARI9_VIA_NOAA_OPEN_DATA",
 generated_at:mins(2),sampled_time:mins(20),points:{duong_dong:{convective_score:34}}};
const local={engine:"PQ_LOCAL_NOW_V2",data_class:"ESTIMATED_NOW",
 generated_at:mins(2),points:{duong_dong:{temp_c:28}}};
const manifest={
 status:"READY",files:{cloud:"/data/weather-runtime/cloud.json"},
 policy:{frontend_source:"SAME_ORIGIN_CANONICAL_ONLY"},
 source_times:{cloud_sampled_time:mins(40),forecast_run_time:mins(700)}
};
const TOKEN="dummy-test-token-do-not-use";
async function scenario(name,{upstream={},site={},active=false,status=204,token=TOKEN}={},expected){
 const candidate={...cloud,...upstream};
 const published={...manifest,...site,
   source_times:{...manifest.source_times,...site.source_times}};
 const calls=[],dispatched=[];
 globalThis.fetch=async (input,options={})=>{
  const url=String(input);
  calls.push(url);
  if(url.includes("/weather-groundtruth/local-now.json"))
   return json(local);
  if(url.includes("/weather-nowcast/compact-latest.json"))
   return json(candidate);
  if(url.includes("/Jotrip-Weather/main/data/local-now.json"))
   return json({...local,generated_at:mins(1)});
  if(url.includes("/Jotrip-Weather/main/data/weather-runtime/manifest.json"))
   return json(published);
  if(url.includes("/weather-observation-overlay.yml/runs?per_page=8"))
   return json({workflow_runs:active?[{id:123,status:"in_progress"}]:[]});
  if(url.includes("/weather-observation-overlay.yml/dispatches")){
   dispatched.push({url,method:options.method,body:options.body});
   return status===204?new Response(null,{status:204}):json({message:"denied"},status);
  }
  throw Error("Unexpected network path during isolated cron test: "+url);
 };
 await app.scheduled({},token?{GITHUB_WEATHER_DISPATCH_TOKEN:token}:{},{});
 assert.equal(dispatched.length,expected.attempts,name);
 assert.equal(calls.filter(x=>x.includes("/weather-nowcast/compact-latest.json")).length,
  expected.sourceProbes??1,name+" must read satellite product once per tick");
 if(expected.attempts){
  assert.equal(dispatched[0].method,"POST");
  assert.deepEqual(JSON.parse(dispatched[0].body),{ref:"main"});
 }
 if(expected.manifestChecks!==undefined)
  assert.equal(calls.filter(x=>x.includes("/weather-runtime/manifest.json")).length,
    expected.manifestChecks,name);
 console.log("PASS scheduled Himawari overlay:",name);
}

await scenario("newer image dispatches despite healthy local-now",{},{
 attempts:1,sourceProbes:1,manifestChecks:1
});
await scenario("same sample does not trigger duplicate writer",{
 site:{source_times:{cloud_sampled_time:cloud.sampled_time}}
},{attempts:0,manifestChecks:1});
await scenario("older published sample cannot be overwritten",{
 site:{source_times:{cloud_sampled_time:mins(5)}}
},{attempts:0,manifestChecks:1});
await scenario("stale imagery must never be promoted",{
 upstream:{sampled_time:mins(75)}
},{attempts:0,manifestChecks:0});
await scenario("active updater suppresses duplicate dispatch",{
 active:true
},{attempts:0,manifestChecks:1});
await scenario("mismatched canonical authority fails closed",{
 site:{policy:{frontend_source:"EXTERNAL"}}
},{attempts:0,manifestChecks:1});
await scenario("GitHub permission errors are not claimed as success",{
 status:403
},{attempts:1,manifestChecks:1});

let touched=0;
globalThis.fetch=async()=>{touched++;throw Error("Cron without secret must not call external network");};
await app.scheduled({},{},{});
assert.equal(touched,0);
console.log("PASS scheduled Himawari overlay: missing secret fails closed");
