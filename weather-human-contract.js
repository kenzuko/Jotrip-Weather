(function(root,factory){
  "use strict";
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  root.JoTripHumanWeather=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";
  const num=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
  const clean=s=>String(s||"").trim();

  function comfort(critical){
    const island=critical?.human_weather?.island;
    if(!island||island.observation_status!=="ACTUAL")return null;
    const actual=island.actual||{},t=num(actual.temperature_c),d=island.derived||{},feels=num(d.feels_like_c);
    if(actual.data_class!=="ACTUAL"||t===null||!d.comfort_label)return null;
    const note=[t.toFixed(1)+"°C đo thực tế"];
    if(feels!==null&&Math.abs(feels-t)>=1)note.push("cảm giác khoảng "+Math.round(feels)+"°C");
    return {
      title:clean(d.comfort_label),
      note:note.join(" · "),
      reason:clean(d.comfort_reason),
      observedAt:island.observed_at||null,
      actualTemperatureC:t,
      feelsLikeC:feels,
      actualLabel:"ACTUAL",
      derivedLabel:"DERIVED_FROM_ACTUAL",
      spatialScope:island.spatial_scope||"ISLAND_ACTUAL_ANCHOR"
    };
  }

  function pointRain(critical,pointId){
    const point=critical?.human_weather?.points?.[pointId];
    const i=point?.interpretation,a=point?.rain?.actual,e=point?.rain?.estimate;
    if(!i)return null;
    if(i.evidence_class==="ACTUAL"&&a?.observation_status==="ACTUAL"){
      return {
        headline:clean(i.headline),detail:clean(i.detail),evidenceClass:"ACTUAL",
        rainObserved:a.rain_observed===true,rateMmH:num(a.derived?.rate_mm_h),
        observedAt:a.observed_at||null,duration:i.duration||null
      };
    }
    if(i.evidence_class==="DERIVED"){
      return {
        headline:clean(i.headline),detail:clean(i.detail),evidenceClass:"DERIVED",
        rainObserved:null,rateMmH:num(e?.rate_mm_h),observedAt:null,duration:null
      };
    }
    return null;
  }

  function pointView(critical,pointId){
    return {comfort:comfort(critical),rain:pointRain(critical,pointId)};
  }

  return {comfort,pointRain,pointView};
});
