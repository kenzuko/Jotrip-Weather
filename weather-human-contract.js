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
    const reference=critical?.human_weather?.reference;
    if(!reference||reference.status!=="ACTUAL")return null;
    const actual=reference.actual||{},t=num(actual.temperature_c),d=reference.derived||{},feels=num(d.feels_like_c);
    if(t===null||!d.label)return null;
    const referenceLocation=reference.location||"Sân bay Phú Quốc";
    const note=[t.toFixed(1)+"°C đo thực tế tại "+referenceLocation];
    if(feels!==null&&Math.abs(feels-t)>=1)note.push("cảm giác khoảng "+Math.round(feels)+"°C");
    return {
      title:clean(d.label),
      note:note.join(" · "),
      reason:clean(d.reason),
      observedAt:reference.at||null,
      actualTemperatureC:t,
      feelsLikeC:feels,
      actualLabel:"ACTUAL",
      derivedLabel:"DERIVED_FROM_ACTUAL",
      spatialScope:reference.scope||"REFERENCE_STATION_ACTUAL",
      referenceLocation
    };
  }

  function pointRain(critical,pointId){
    const item=critical?.human_weather?.rain?.[pointId];
    if(!item)return null;
    if(item.evidence==="ACTUAL"){
      return {
        headline:clean(item.headline),detail:clean(item.detail),evidenceClass:"ACTUAL",
        rainObserved:item.observed===true,rateMmH:num(item.derived_rate_mm_h),
        observedAt:item.at||null,duration:item.duration_min||null
      };
    }
    if(item.evidence==="DERIVED"){
      return {
        headline:clean(item.headline),detail:clean(item.detail),evidenceClass:"DERIVED",
        rainObserved:null,rateMmH:num(item.estimated_rate_mm_h),observedAt:null,duration:null
      };
    }
    return null;
  }

  function pointView(critical,pointId){
    return {comfort:comfort(critical),rain:pointRain(critical,pointId)};
  }

  return {comfort,pointRain,pointView};
});
