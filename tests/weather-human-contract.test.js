const assert=require("node:assert/strict");
const h=require("../weather-human-contract.js");

const critical={human_weather:{
  island:{observation_status:"ACTUAL",spatial_scope:"ISLAND_ACTUAL_ANCHOR",
    observed_at:"2026-09-30T03:00:00Z",
    actual:{temperature_c:31,dewpoint_c:27,wind_kmh:4,data_class:"ACTUAL"},
    derived:{humidity_percent:79.3,comfort_label:"Nóng và rất oi",comfort_reason:"Độ ẩm cao làm cơ thể cảm thấy nóng hơn nhiệt độ đo được.",
      feels_like_c:40.6,data_class:"DERIVED_FROM_ACTUAL"}},
  points:{an_thoi:{rain:{actual:{observation_status:"ACTUAL",rain_observed:true,
      derived:{rate_mm_h:1.8,intensity_label:"mưa rào nhẹ",data_class:"DERIVED_FROM_ACTUAL"},
      observed_at:"2026-09-30T02:50:00Z"}},
    interpretation:{headline:"An Thới đang có mưa rào nhẹ.",
      detail:"Dự kiến mưa sẽ giảm trong khoảng 30-45 phút.",evidence_class:"ACTUAL",
      duration:{lower_minutes:30,upper_minutes:45,data_class:"DERIVED"}}}}
}};

{
  const v=h.pointView(critical,"an_thoi");
  assert.equal(v.comfort.title,"Nóng và rất oi");
  assert.equal(v.comfort.note,"31.0°C đo thực tế · cảm giác khoảng 41°C");
  assert.equal(v.comfort.actualLabel,"ACTUAL");
  assert.equal(v.comfort.derivedLabel,"DERIVED");
  assert.equal(v.rain.headline,"An Thới đang có mưa rào nhẹ.");
  assert.equal(v.rain.detail,"Dự kiến mưa sẽ giảm trong khoảng 30-45 phút.");
  assert.equal(v.rain.evidenceClass,"ACTUAL");
  assert.equal(v.rain.duration.data_class,"DERIVED");
}
{
  const stale=structuredClone(critical);
  stale.human_weather.island.observation_status="LAST_OBSERVED";
  stale.human_weather.island.actual.data_class="ACTUAL_STALE";
  assert.equal(h.comfort(stale),null);
}
{
  const est=structuredClone(critical);
  est.human_weather.points.an_thoi={
    rain:{actual:null,estimate:{rate_mm_h:2.1,data_class:"ESTIMATED_NOW"}},
    interpretation:{headline:"An Thới có tín hiệu mưa rào nhẹ.",
      detail:"Đây là ước tính tại điểm, chưa phải số đo trực tiếp.",evidence_class:"DERIVED"}
  };
  const r=h.pointRain(est,"an_thoi");
  assert.equal(r.evidenceClass,"DERIVED");
  assert.equal(r.rainObserved,null);
}
assert.equal(JSON.stringify(h.pointView(critical,"an_thoi")).includes("source"),false);
console.log("weather human contract tests passed");
