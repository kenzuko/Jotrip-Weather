import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

// Test the actual browser selection/failover code, not a rewritten approximation.
const src=readFileSync(process.argv[2]||"weather-v2.js","utf8");
const start=src.indexOf("function completeDashboardCandidate(");
const end=src.indexOf("\nasync function loadEngineDashboard()",start);
assert(start>=0&&end>start,"canonical dashboard recovery functions missing");
assert(src.includes("ENGINE_DASHBOARD_CANONICAL,RUNTIME_AUTHORITY"),
 "canonical dashboard must use the no-store fetch path");
const ctx={Date,console:{warn(){}},
 ENGINE_DASHBOARD:"/data/dashboard-data.json",
 ENGINE_DASHBOARD_CANONICAL:"https://raw.githubusercontent.com/kenzuko/Jotrip-Lab/feat/weather-lab-data-engine-v1/weather/dashboard-data.json",
 critical:{snapshot_id:"mirror"},
 globalThis:{JoTripWindGuard:{dashboardUsable:d=>{
  const age=(Date.now()-Date.parse(d?.generated_at||""))/60000;
  return age>=-10&&age<=150;
 }}}};
vm.createContext(ctx);
vm.runInContext(src.slice(start,end),ctx);
const now=Date.now();
const stamp=minutesAgo=>new Date(now-minutesAgo*60000).toISOString();
const future=new Date(now+3*3600000).toISOString();
const points=()=>Object.fromEntries(
 ["duong_dong","an_thoi","ganh_dau","cua_can","bai_thom","ham_ninh","bai_sao","rach_gia"]
 .map(id=>[id,{hours:[{time_iso:future,wind:12,gust:24,rain:0.3,wave:0.5}]}]));
const make=(ageMin,cycleAgeMin,id)=>({
 report_status:"LIVE",generated_at:stamp(ageMin),snapshot_id:id,
 source_cycles:{ECMWF:stamp(cycleAgeMin),ICON:stamp(cycleAgeMin)},
 points:points()
});
const local=ctx.ENGINE_DASHBOARD,remote=ctx.ENGINE_DASHBOARD_CANONICAL;
let requests=[];
const mock=(mirror,latest)=>{requests=[];ctx.getJSON=async url=>{
 requests.push(url);
 const data=url===local?mirror:url===remote?latest:null;
 if(data instanceof Error)throw data;
 return data;
}};
const fresh=make(10,240,"mirror");
mock(fresh,make(3,240,"newer"));
assert.equal(await ctx.freshestEngineDashboard(),fresh,"fresh aligned mirror must remain first choice");
assert.deepEqual(requests,[local],"avoid cross-origin request when local publication is verified");
const stale=make(181,240,"mirror"),newer=make(5,240,"canonical");
mock(stale,newer);
assert.equal(await ctx.freshestEngineDashboard(),newer,"late mirror should recover from new canonical engine");
assert.deepEqual(requests,[local,remote]);
ctx.critical={snapshot_id:"canonical"};
mock(fresh,newer);
assert.equal(await ctx.freshestEngineDashboard(),newer,"snapshot mismatch requires newer source check");
ctx.critical={snapshot_id:"mirror"};
const betterCycle=make(181,120,"mirror"),olderCycle=make(5,240,"canonical");
mock(betterCycle,olderCycle);
assert.equal(await ctx.freshestEngineDashboard(),betterCycle,
 "a newer publish timestamp must not replace a more recent ECMWF cycle");
const invalid=make(5,240,"canonical");invalid.points.an_thoi.hours=[];
mock(stale,invalid);
assert.equal(await ctx.freshestEngineDashboard(),stale,
 "malformed newer forecast must be rejected; normal safety gate then blocks stale UI");
mock(new Error("mirror offline"),newer);
assert.equal(await ctx.freshestEngineDashboard(),newer,"canonical fallback also works on static mirror HTTP failure");
mock(new Error("mirror offline"),new Error("upstream offline"));
await assert.rejects(()=>ctx.freshestEngineDashboard(),"both sources unavailable must show a real data error");
console.log("PASS standalone Weather: mirror freshness, failover, cycles, contract validation and outage safety");
