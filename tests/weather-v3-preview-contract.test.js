const assert=require("node:assert/strict");
const v3=require("../weather-v3-preview-contract.js");

const payload={
  schema_version:"weather-v3-ui-preview-v1",
  status:"PREPARED_DISABLED",
  public_ui_enabled:false,
  public_authority:"WEATHER_V2",
  points:{
    an_thoi:{
      actual_rain:null,
      radar:{
        evidence:"REMOTE_OBSERVED",
        observed_at:"2026-10-01T09:00:00Z",
        coverage:"LIMITED",
        center_dbz:null,
        max_dbz_15km:null,
        max_dbz_30km:10,
        valid_fraction_15km:0.2,
        negative_evidence_is_weak:true
      },
      satellite:{
        evidence:"REMOTE_OBSERVED",
        observed_at:"2026-10-01T09:00:00Z",
        convective_score:80,
        level:"HIGH"
      },
      nowcast:{
        status:"LEARNING",
        public_usable:false,
        candidates:[{
          window:"0_30_MIN",
          eta_minutes:18,
          confidence:"LOW_TWO_FRAME_SHADOW",
          public_usable:false
        }]
      }
    }
  }
};

{
  const gate=v3.readiness(payload);
  assert.equal(gate.publicReady,false);
  assert.equal(gate.publicAuthority,"WEATHER_V2");
}
{
  const internal=v3.internalPointView(payload,"an_thoi");
  assert.equal(internal.mode,"INTERNAL_PREVIEW");
  assert.equal(internal.radar.evidenceClass,"REMOTE_OBSERVED");
  assert.equal(internal.radar.negativeEvidenceIsWeak,true);
  assert.equal(internal.publicNowcast,null,
    "shadow ETA must never leak into public copy");
}
{
  assert.equal(v3.publicPointView(payload,"an_thoi"),null,
    "dormant V3 contract must render nothing publicly");
}
{
  const ready=structuredClone(payload);
  ready.status="PUBLIC_READY";
  ready.public_ui_enabled=true;
  ready.points.an_thoi.nowcast.candidates[0].public_usable=true;
  const view=v3.publicPointView(ready,"an_thoi");
  assert.equal(view.mode,"PUBLIC");
  assert.equal(view.nowcast.evidenceClass,"DERIVED_NOWCAST");
  assert.equal(view.nowcast.etaMinutes,18);
}
{
  const limited=structuredClone(payload.points.an_thoi);
  limited.radar.max_dbz_30km=null;
  const radar=v3.radarSummary(limited);
  assert.match(radar.headline,/chưa đủ phủ/i);
}
console.log("weather v3 dormant UI contract tests passed");
