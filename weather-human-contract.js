(function(root,factory){
  "use strict";
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  root.JoTripHumanWeather=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";
  const num=v=>{if((typeof v!=="number"&&typeof v!=="string")||(typeof v==="string"&&!v.trim()))return null;const n=Number(v);return Number.isFinite(n)?n:null};
  const clean=s=>String(s||"").trim();

  function comfort(critical){
    const reference=critical?.human_weather?.reference;
    if(!reference||reference.status!=="ACTUAL")return null;
    const actual=reference.actual||{},t=num(actual.temperature_c),d=reference.derived||{},feels=num(d.feels_like_c);
    if(t===null||!d.label)return null;
    const referenceLocation=reference.location||"Sân bay Phú Quốc";
    const humidity=num(d.humidity_pct);
    const showHeatIndex=feels!==null&&Math.abs(feels-t)>=1;
    return {
      title:clean(d.label),
      note:t.toFixed(1)+"°C đo thực tế tại "+referenceLocation,
      heatIndexText:showHeatIndex?"Chỉ số cảm giác nóng: khoảng "+Math.round(feels)+"°C":null,
      heatIndexMethod:showHeatIndex&&humidity!==null
        ?"Tính từ nhiệt độ "+Math.round(t)+"°C và độ ẩm khoảng "+Math.round(humidity)+"%."
        :null,
      heatIndexNote:showHeatIndex?"Đây là chỉ số suy ra, không phải nhiệt độ đo trực tiếp.":null,
      reason:clean(d.reason),
      observedAt:reference.at||null,
      actualTemperatureC:t,
      feelsLikeC:feels,
      humidityPct:humidity,
      actualLabel:"ACTUAL",
      derivedLabel:"DERIVED_FROM_ACTUAL",
      spatialScope:reference.scope||"REFERENCE_STATION_ACTUAL",
      referenceLocation
    };
  }

  function pointRain(critical,pointId){
    const item=critical?.human_weather?.rain?.[pointId];
    if(!item)return null;
    if(item.evidence==="ACTUAL"&&item.observed===true){
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
