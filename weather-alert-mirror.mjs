// JoTrip Lab's independent, append-only, public alert archive.
// Source inputs are already locally mirrored by sync-weather-runtime.yml.
import {readFile,writeFile,mkdir,readdir} from "node:fs/promises";
import {existsSync} from "node:fs";
import {join,dirname} from "node:path";
import {execFileSync} from "node:child_process";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
globalThis.JoTripWindGuard=require("./weather-wind-guard.js");
const gust=require("./weather-gust-outlook.js");
const ledger=require("./weather-alert-ledger.js");
const base="data/alerts";
const dry=process.argv.includes("--dry-run");
const merging=process.argv.includes("--merge-remote");
const json=async(file,fallback)=>{try{return JSON.parse(await readFile(file,"utf8"))}catch{return fallback}};
const save=async(file,data)=>{if(!dry){await mkdir(dirname(file),{recursive:true});await writeFile(file,JSON.stringify(data)+"\n")}};
function remote(path,fallback){
 try{return JSON.parse(execFileSync("git",["show","origin/main:"+path],{encoding:"utf8",stdio:["ignore","pipe","ignore"]}))}
 catch{return fallback}
}
const newer=(a,b)=>Date.parse(a||0)>Date.parse(b||0);
function uniqueEvents(left,right){
 const merged=new Map();
 for(const e of [...(left||[]),...(right||[])])if(e?.event_id)merged.set(e.event_id,e);
 return [...merged.values()].sort((a,b)=>a.changed_at.localeCompare(b.changed_at));
}
const newestStates=(left,right)=>{
 const all=new Map();
 for(const s of [...(left||[]),...(right||[])]){
  if(!s?.alert_id)continue;
  const prev=all.get(s.alert_id);
  if(!prev||newer(s.updated_at,prev.updated_at)||
     (s.updated_at===prev.updated_at&&newer(s.last_seen_at,prev.last_seen_at)))all.set(s.alert_id,s);
 }
 return [...all.values()];
};
async function main(){
 if(merging){
  const latestPath=join(base,"latest.json"),statesPath=join(base,"states.json");
  const localLatest=await json(latestPath,null),remoteLatest=remote(latestPath,null);
  if(remoteLatest&&(!localLatest||newer(remoteLatest.generated_at,localLatest.generated_at)))
    await save(latestPath,remoteLatest);
  const current=await json(statesPath,{states:[]}),existing=remote(statesPath,{states:[]});
  await save(statesPath,{schema_version:"jotrip-alert-states-v1",
    generated_at:newer(current.generated_at,existing.generated_at)?current.generated_at:existing.generated_at,
    states:newestStates(existing.states,current.states)});
  const localIndex=await json(join(base,"history-index.json"),{dates:[]});
  const remoteIndex=remote(join(base,"history-index.json"),{dates:[]});
  const dates=[...new Set([...(localIndex.dates||[]),...(remoteIndex.dates||[])])].sort().reverse();
  for(const day of dates.slice(0,3)){
   const path=join(base,"history",day+".json");
   const l=await json(path,{events:[]}),r=remote(path,{events:[]});
   await save(path,{schema_version:"jotrip-alert-events-v1",date:day,
     events:uniqueEvents(r.events,l.events)});
  }
  await save(join(base,"history-index.json"),{schema_version:"jotrip-alert-index-v1",dates});
  console.log("PASS: Weather alert archive reconciled with newer mirror commits");
  return;
 }
 const [critical,dashboard,nowcast,ground]=await Promise.all([
  json("data/critical.json",null),json("data/dashboard-data.json",null),
  json("data/nowcast-compact.json",null),json("data/groundtruth.json",null)
 ]);
 if(!critical?.points||!dashboard?.points)throw Error("Critical or dashboard missing - do not overwrite prior archive");
 const now=Date.now();
 const publication=gust.islandAlerts({critical,dashboard,nowcast,groundtruth:ground,now});
 const previous=await json(join(base,"states.json"),{states:[]});
 const plan=ledger.nextState(previous.states,publication,now);
 const day=new Date(now).toISOString().slice(0,10);
 const historyPath=join(base,"history",day+".json");
 const history=await json(historyPath,{events:[]});
 const events=uniqueEvents(history.events,plan.transitions);
 await save(historyPath,{schema_version:"jotrip-alert-events-v1",date:day,events});
 await save(join(base,"states.json"),{schema_version:"jotrip-alert-states-v1",
  generated_at:plan.timestamp,states:plan.states});
 await save(join(base,"latest.json"),publication);
 const snap=publication.model_valid?ledger.snapshot(dashboard,now):null;
 if(snap){
  const clean=String(snap.snapshot_id).replace(/[^a-zA-Z0-9_.-]/g,"_").slice(0,125);
  const file=join(base,"snapshots",day,clean+".json");
  if(!existsSync(file))await save(file,snap);
 }
 const oldIndex=await json(join(base,"history-index.json"),{dates:[]});
 const allDates=[...new Set([day,...(oldIndex.dates||[])])].sort().reverse();
 await save(join(base,"history-index.json"),{schema_version:"jotrip-alert-index-v1",dates:allDates});
 // Verified station observations: airport is NOT an offshore An Thoi anemometer.
 const obsPath=join(base,"observations",day+".json");
 const oldObs=await json(obsPath,{stations:[]});
 const observations=new Map((oldObs.stations||[]).map(x=>[x.station_id+"|"+x.observed_at,x]));
 const v=ground?.atmosphere?.vvpq;
 if(v?.qc==="PASS"&&v.source_channel==="METAR"&&v.observed_at){
  const obsGust=gust.metarGust(ground,Date.parse(v.observed_at)+5*60000);
  observations.set("VVPQ|"+v.observed_at,{station_id:"VVPQ",
   lat:v.lat,lon:v.lon,observed_at:v.observed_at,
   wind_kmh:v.wind_speed_kmh??null,gust_kmh:obsGust?.gust_kmh??null,
   source:"ACTUAL_METAR"});
 }
 for(const st of Object.values(ground?.rainfall?.stations||{})){
  if(st.qc!=="PASS"||!st.station_id||!st.observed_at)continue;
  observations.set(st.station_id+"|"+st.observed_at,{
   station_id:st.station_id,lat:st.lat,lon:st.lon,observed_at:st.observed_at,
   period_start:st.period_start||ground?.rainfall?.period_start||null,
   accumulation_mm:st.accumulation_mm??null,increment_mm:st.increment_mm??null,
   source:"ACTUAL_VRAIN"});
 }
 await save(obsPath,{schema_version:"jotrip-alert-station-evidence-v1",date:day,
  stations:[...observations.values()].sort((a,b)=>a.observed_at.localeCompare(b.observed_at))});
 console.log(JSON.stringify({result:"PASS",dry_run:dry,snapshot_saved:Boolean(snap),
  alerts:publication.alerts.length,transitions:plan.transitions.length,
  observed_stations:observations.size,source_classes:["MODEL_ONLY","ACTUAL_METAR","ACTUAL_VRAIN"]}));
}
main().catch(e=>{console.error(e.stack||String(e));process.exitCode=1});
