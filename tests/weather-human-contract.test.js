const assert=require("node:assert/strict");
const h=require("../weather-human-contract.js");

const critical={human_weather:{
  reference:{status:"ACTUAL",at:"2026-09-30T03:00:00Z",scope:"REFERENCE_STATION_ACTUAL",
    location:"Sân bay Phú Quốc",
    actual:{temperature_c:31,dewpoint_c:27,wind_kmh:4,class:"ACTUAL"},
    derived:{humidity_pct:79.3,label:"Nóng và rất oi",
      reason:"Độ ẩm cao làm cơ thể cảm thấy nóng hơn nhiệt độ đo được.",
      feels_like_c:40.6,class:"DERIVED_FROM_ACTUAL"}},
  points:{an_thoi:{rain:{actual:{status:"ACTUAL",observed:true,class:"ACTUAL",
      derived:{rate_mm_h:1.8,class:"DERIVED_FROM_ACTUAL"}}},
    message:{headline:"An Thới đang có mưa rào nhẹ.",
      detail:"Dự kiến mưa sẽ giảm trong khoảng 30-45 phút.",evidence:"ACTUAL",duration_min:[30,45]}}}
}};

{
  const v=h.pointView(critical,"an_thoi");
  assert.equal(v.comfort.title,"Nóng và rất oi");
  assert.equal(v.comfort.note,"31.0°C đo thực tế tại Sân bay Phú Quốc · cảm giác khoảng 41°C");
  assert.equal(v.comfort.actualLabel,"ACTUAL");
  assert.equal(v.comfort.derivedLabel,"DERIVED_FROM_ACTUAL");
  assert.equal(v.comfort.spatialScope,"REFERENCE_STATION_ACTUAL");
  assert.equal(v.comfort.referenceLocation,"Sân bay Phú Quốc");
  assert.equal(v.rain.headline,"An Thới đang có mưa rào nhẹ.");
  assert.equal(v.rain.detail,"Dự kiến mưa sẽ giảm trong khoảng 30-45 phút.");
  assert.equal(v.rain.evidenceClass,"ACTUAL");
  assert.deepEqual(v.rain.duration,[30,45]);
}
{
  const stale=structuredClone(critical);
  stale.human_weather.reference.status="LAST_OBSERVED";
  stale.human_weather.reference.actual.class="ACTUAL_STALE";
  assert.equal(h.comfort(stale),null);
}
{
  const est=structuredClone(critical);
  est.human_weather.points.an_thoi={
    rain:{actual:null,estimate:{rate_mm_h:2.1,class:"ESTIMATED_NOW"}},
    message:{headline:"An Thới có tín hiệu mưa nhẹ.",
      detail:"Đây là ước tính tại điểm, chưa phải số đo trực tiếp.",evidence:"DERIVED"}
  };
  const r=h.pointRain(est,"an_thoi");
  assert.equal(r.evidenceClass,"DERIVED");
  assert.equal(r.rainObserved,null);
}
assert.equal(JSON.stringify(h.pointView(critical,"an_thoi")).includes("source"),false);
console.log("weather human contract tests passed");
