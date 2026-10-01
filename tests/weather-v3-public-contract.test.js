const assert=require("node:assert/strict");
const v3=require("../weather-v3-public-contract.js");

const NOW=Date.parse("2026-10-01T10:00:00Z");

{
  const critical={human_weather:{rain:{an_thoi:{
    evidence:"ACTUAL",observed:true,at:"2026-10-01T09:50:00Z",
    headline:"An Thới đang có mưa rào nhẹ.",detail:"Mưa đang được ghi nhận tại điểm."
  }}}};
  const view=v3.nowView(critical,"an_thoi",NOW);
  assert.equal(view.evidenceClass,"ACTUAL");
  assert.equal(view.state,"ACTUAL_RAIN");
}
{
  const critical={human_weather:{rain:{an_thoi:{
    evidence:"ACTUAL",observed:true,at:"2026-10-01T08:00:00Z",
    headline:"An Thới đang có mưa.",detail:"cũ"
  }}}};
  const view=v3.nowView(critical,"an_thoi",NOW);
  assert.equal(view.state,"NO_DIRECT_RAIN_CONFIRMATION");
  assert.match(view.detail,/không dùng dữ liệu thiếu/i);
}
{
  const nowcast={
    sampled_time:"2026-10-01T09:50:00Z",
    points:{an_thoi:{score:90,cloud_motion:{
      public_track_usable:true,predicted_impact:true,eta_minutes:42,status:"APPROACHING"
    }}}
  };
  const view=v3.soonView(nowcast,"an_thoi",NOW);
  assert.equal(view.evidenceClass,"DERIVED_NOWCAST");
  assert.equal(view.window,"30_60_MIN");
  assert.match(view.detail,/chưa phải mưa đo tại mặt đất/i);
}
{
  const nowcast={
    sampled_time:"2026-10-01T09:50:00Z",
    points:{an_thoi:{score:90,cloud_motion:{
      public_track_usable:true,predicted_impact:false,status:"PASSING_BY"
    }}}
  };
  const view=v3.soonView(nowcast,"an_thoi",NOW);
  assert.equal(view.state,"PASSING_BY");
  assert.doesNotMatch(view.headline,/mưa đang tới/i);
}
{
  const nowcast={
    sampled_time:"2026-10-01T08:00:00Z",
    points:{an_thoi:{score:100,cloud_motion:{public_track_usable:true,predicted_impact:true,eta_minutes:10}}}
  };
  const view=v3.soonView(nowcast,"an_thoi",NOW);
  assert.equal(view.state,"STALE");
}
{
  const out=v3.pointView({},{},"duong_dong",NOW);
  assert.equal(out.status,"PUBLIC_BETA");
  assert.equal(out.policy.v2DecisionAuthority,true);
  assert.equal(out.policy.radarNegativeNeverMeansDry,true);
  assert.equal(out.policy.preciseEtaDisabled,true);
  assert.equal(out.policy.lightningPublicDisabled,true);
}
console.log("weather v3 public beta contract tests passed");
