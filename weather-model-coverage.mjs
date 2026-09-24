// Validate four-field marine model provenance. A missing forecast gust is
// UNKNOWN, never 0 km/h and never grounds to remove an otherwise valid hour.
import {readFile,writeFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import assert from "node:assert/strict";

const POINTS=["duong_dong","an_thoi","ganh_dau","cua_can","bai_thom","ham_ninh","bai_sao","rach_gia"];
const FIELDS=["wind_kmh","gust_kmh","rain_3h_mm","wave_hs_m"];
const numeric=v=>typeof v==="number"&&Number.isFinite(v);

export function annotateModelGaps(bundle){
  const points=bundle?.model_72h?.points;
  if(!points||typeof points!=="object")throw Error("Missing model_72h.points");
  const gaps=[],coverage={};
  for(const point of POINTS){
    const rows=points[point];
    if(!Array.isArray(rows)||!rows.length)throw Error(point+": missing model rows");
    let gustAvailable=0;
    for(const row of rows){
      if(!row.time||row.data_class!=="MODEL_ONLY")throw Error(point+": invalid model row");
      const missing=FIELDS.filter(field=>!numeric(row[field]));
      const mandatory=missing.filter(field=>field!=="gust_kmh");
      if(mandatory.length)throw Error(point+": missing required "+mandatory.join(",")+" at "+row.time);
      // Remove obsolete metadata from previously incomplete but now restored rows.
      row.missing_fields=missing;
      row.data_quality=missing.length?"PARTIAL_MODEL":"COMPLETE_MODEL";
      if(numeric(row.gust_kmh))gustAvailable++;
      else gaps.push({point,time:row.time,field:"gust_kmh"});
    }
    coverage[point]=Math.round(100*gustAvailable/rows.length);
    if(gustAvailable/rows.length<0.8)
      throw Error(point+": gust coverage below 80%; reject insufficient model");
  }
  bundle.model_72h.quality={
    schema_version:"weather-model-coverage-v1",
    checked_at:new Date().toISOString(),
    gust_coverage_percent:coverage,
    missing_gust:gaps
  };
  return {bundle,gaps,coverage};
}

function fixture(){
 const points=Object.fromEntries(POINTS.map(point=>[point,Array.from({length:10},(_,i)=>({
  time:"2026-09-25T"+String(i).padStart(2,"0")+":00:00+07:00",
  wind_kmh:15,gust_kmh:i===8?null:25,rain_3h_mm:0.4,wave_hs_m:1.1,
  data_class:"MODEL_ONLY"
 }))]));
 return {model_72h:{points}};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 const mode=process.argv[2]||"--test";
 if(mode==="--test"){
   const {bundle,gaps,coverage}=annotateModelGaps(fixture());
   assert.equal(gaps.length,8);
   assert.equal(coverage.duong_dong,90);
   assert.equal(bundle.model_72h.points.duong_dong[8].gust_kmh,null);
   assert.deepEqual(bundle.model_72h.points.duong_dong[8].missing_fields,["gust_kmh"]);
   assert.equal(bundle.model_72h.points.duong_dong[8].data_quality,"PARTIAL_MODEL");
   const bad=fixture();bad.model_72h.points.an_thoi[0].wave_hs_m=null;
   assert.throws(()=>annotateModelGaps(bad),/missing required wave_hs_m/);
   const allMissing=fixture();allMissing.model_72h.points.duong_dong.forEach(x=>x.gust_kmh=null);
   assert.throws(()=>annotateModelGaps(allMissing),/coverage below 80/);
   console.log("PASS: preserve model hours, never invent gusts, enforce 80% coverage");
 }else if(mode==="--apply"){
   const path="data/current-bundle.json";
   const json=JSON.parse(await readFile(path,"utf8"));
   const {bundle,gaps,coverage}=annotateModelGaps(json);
   await writeFile(path,JSON.stringify(bundle)+"\n");
   console.log(JSON.stringify({result:"PASS",model_points:Object.keys(coverage).length,gust_gaps:gaps,coverage}));
 }else throw Error("Unknown mode: "+mode);
}
