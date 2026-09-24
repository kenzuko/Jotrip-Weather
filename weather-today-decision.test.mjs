import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const src=readFileSync(process.argv[2]||"weather-v2.js","utf8");
const start=src.indexOf("function todayUiState("),end=src.indexOf("\nfunction todayWeatherIcon(",start);
assert(start>=0&&end>start,"Cannot locate real todayUiState");
const code=src.slice(start,end);
const ctx={num:x=>typeof x==="number"&&Number.isFinite(x)?x:null,
  fmt:(x,n)=>x.toFixed(n),safeModelGust:r=>r&&Number.isFinite(r.wind)&&Number.isFinite(r.gust)&&r.wind>=0&&r.gust>=r.wind?r.gust:null,
  todayLiveOverride:()=>null,Date,globalThis:{}};
vm.runInNewContext(code,ctx);
const row=(rain,wind,gust,wave,offshore=true)=>({rain,wind,gust,wave,time_iso:"2026-09-24T16:00:00+07:00",wave_reference:offshore?{status:"PASS"}:{status:"UNVERIFIED"}});
const check=(name,input,expected,fragment="")=>{const x=ctx.todayUiState(input,1);assert.equal(x.cls,expected,name);if(fragment)assert(x.reason?.includes(fragment),name+" explanation missing");console.log("PASS "+name+" -> "+x.cls);};
check("screenshot 16h: rain 7.6 gust 37 offshore wave 1.62",row(7.6,16,37,1.62),"watch","sóng ngoài khơi");
check("screenshot 19h: rain 7 gust 33 offshore wave 1.53",row(7,15,33,1.53),"watch","mưa");
check("offshore wave alone gets caution",row(0,8,14,1.55),"watch","không đại diện sát bờ");
check("unverified offshore wave does NOT pretend to be nearshore",row(0,8,14,1.55,false),"good");
check("heavy rain 20mm per 3h",row(20,12,22,.6),"avoid","mưa lớn");
check("strong forecast gust",row(0,18,55,.6),"avoid","gió giật");
check("strong sustained wind",row(0,40,48,.6),"avoid","gió");
check("missing gust cannot be green",row(0,8,null,.6),"watch","Thiếu");
check("incomparable gust cannot be green",row(0,25,12,.6),"watch","Thiếu");
check("dry calm valid forecast",row(0,8,14,.6),"good");
console.log("10/10 multi-hazard forecast decisions PASS");
