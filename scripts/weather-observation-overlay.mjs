// Publish verified Himawari observations independently of forecast availability.
// Only observation artifacts may change. Never edit forecast/current/critical.
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {join,dirname,resolve} from "node:path";
import {pathToFileURL} from "node:url";

const CLOUD_FIELDS=["lat","lon","cloud_top_cold_c","cloud_top_median_c",
 "cloud_top_high_m","cloud_top_median_m","cooling_c_per_20m_proxy",
 "convective_score","convective_level"];
const stamp=v=>{const n=Date.parse(v||"");return Number.isFinite(n)?n:null;};
const validTime=(v,now,maxAge=60*60000)=>{
 const n=stamp(v);
 return n!==null&&n<=now+5*60000&&now-n<=maxAge;
};
const parseJson=async file=>JSON.parse(await readFile(file,"utf8"));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function compactCloud(raw){
 const spatial=raw.spatial;
 return {
  status:raw.status,generated_at:raw.generated_at,sampled_time:raw.sampled_time,
  source:raw.source,source_type:raw.source_type,
  observation_resolution:raw.observation_resolution,
  spatial:{
   status:spatial.status,bounds:spatial.bounds,
   display_grid_deg:spatial.display_grid_deg,
   sampling_method:spatial.sampling_method,
   frames:spatial.frames.slice(-6).map(frame=>({
    sampled_time:frame.sampled_time,
    cells:(frame.cells||[]).map(cell=>Object.fromEntries(CLOUD_FIELDS.map(key=>[key,cell[key]??null])))
   }))
  }
 };
}

export function planObservationOverlay(published,upstream,now=Date.now()){
 const {manifest,cloud:oldCloud,compact:oldCompact}=published;
 const {cloud,compact}=upstream;
 if(manifest?.status!=="READY"||
   manifest?.policy?.frontend_source!=="SAME_ORIGIN_CANONICAL_ONLY"||
   manifest?.files?.cloud!=="/data/weather-runtime/cloud.json")
  throw Error("canonical Weather runtime manifest contract mismatch");
 if(cloud?.status!=="POINT_NUMERIC_READY"||!String(cloud.source||"").includes("HIMAWARI")||
   !cloud.spatial||cloud.spatial.status!=="READY"||
   !Array.isArray(cloud.spatial.frames)||!cloud.spatial.frames.length)
  throw Error("source does not contain verified Himawari spatial observations");
 const last=cloud.spatial.frames.at(-1);
 if(!Array.isArray(last?.cells)||!last.cells.length||
   Math.abs(stamp(last.sampled_time)-stamp(cloud.sampled_time))>20*60000)
  throw Error("Himawari last frame and observation timestamp do not agree");
 if(!validTime(cloud.sampled_time,now)||!validTime(cloud.generated_at,now,90*60000))
  return {status:"STALE_SOURCE",updated:false,reason:"source_cloud_not_fresh",files:{}};
 const oldAt=Math.max(stamp(oldCloud?.sampled_time)||0,
  stamp(manifest.source_times?.cloud_sampled_time)||0);
 const nextAt=stamp(cloud.sampled_time);
 if(nextAt<=oldAt)return {status:"UNCHANGED",updated:false,reason:"not_newer",files:{}};
 if(compact?.status!=="POINT_NUMERIC_READY"||!compact.points||
   !Object.keys(compact.points).length||!validTime(compact.sampled_time,now)||
   !validTime(compact.generated_at,now,90*60000)||
   stamp(compact.sampled_time)!==nextAt)
  throw Error("compact Himawari observations must match the promoted cloud sample");
 const oldCompactAt=stamp(oldCompact?.sampled_time)||0;
 if(stamp(compact.sampled_time)<oldCompactAt)
  throw Error("compact overlay would regress the currently published source");
 const nextManifest={
  ...manifest,generated_at:new Date(now).toISOString(),
  source_times:{
   ...manifest.source_times,
   cloud_sampled_time:cloud.sampled_time,
   compact_sampled_time:compact.sampled_time
  },
  observation_overlay:{
   status:"VERIFIED_INDEPENDENT_ACTUAL",updated_at:new Date(now).toISOString(),
   source:"JOTRIP_LAB_DATA_WEATHER",source_sampled_time:cloud.sampled_time,
   forecast_unchanged:true
  }
 };
 // This updater NEVER accesses or changes forecast, critical, current or model authority.
 const cloudScene=compactCloud(cloud);
 return {status:"UPDATED",updated:true,reason:"newer_verified_himawari_sample",
   sampled_time:cloud.sampled_time,files:{
    "data/nowcast.json":cloud,
    "data/nowcast-compact.json":compact,
    "data/weather-runtime/cloud.json":cloudScene,
    "data/weather-runtime/compact.json":compact,
    "data/weather-runtime/manifest.json":nextManifest,
    "data/weather-scene/cloud.json":cloudScene,
    "data/weather-scene/compact.json":compact
   }
 };
}

async function main(){
 const args=process.argv.slice(2),arg=k=>args.indexOf(k)>=0?args[args.indexOf(k)+1]:null;
 const source=resolve(arg("--source")||"lab-data/data"),dry=args.includes("--dry-run");
 const published={
  manifest:await parseJson("data/weather-runtime/manifest.json"),
  cloud:await parseJson("data/weather-runtime/cloud.json"),
  compact:await parseJson("data/weather-runtime/compact.json")
 };
 const upstream={
  cloud:await parseJson(join(source,"weather-nowcast/latest.json")),
  compact:await parseJson(join(source,"weather-nowcast/compact-latest.json"))
 };
 const p=planObservationOverlay(published,upstream);
 console.log(JSON.stringify({status:p.status,reason:p.reason,sampled_time:p.sampled_time,
  updated_files:Object.keys(p.files),dry_run:dry,
  retained_forecast_run_time:published.manifest.source_times.forecast_run_time}));
 if(!p.updated||dry)return;
 for(const [file,value] of Object.entries(p.files)){
  await mkdir(dirname(file),{recursive:true});
  await writeFile(file,JSON.stringify(value)+"\n","utf8");
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 main().catch(error=>{console.error("OBSERVATION_OVERLAY_ABORT:",error.message);process.exitCode=1;});
}
