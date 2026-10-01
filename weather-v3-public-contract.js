(function(root,factory){
  "use strict";
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  root.JoTripWeatherV3Public=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";

  const num=v=>{
    if(v===null||v===undefined||v===""||(typeof v==="string"&&!v.trim()))return null;
    const n=Number(v);
    return Number.isFinite(n)?n:null;
  };
  const clean=s=>String(s||"").trim();

  function ageMinutes(iso,nowMs=Date.now()){
    const t=Date.parse(iso||"");
    return Number.isFinite(t)?Math.max(0,(nowMs-t)/60000):Infinity;
  }

  function nowView(critical,pointId,nowMs=Date.now()){
    const item=critical?.human_weather?.rain?.[pointId];
    if(item?.evidence==="ACTUAL"&&item?.observed===true&&ageMinutes(item.at,nowMs)<=45){
      return {
        state:"ACTUAL_RAIN",
        evidenceClass:"ACTUAL",
        headline:clean(item.headline)||"Đang có mưa ở khu vực này.",
        detail:clean(item.detail)||"Số đo mới đang ghi nhận mưa ở khu vực này.",
        observedAt:item.at||null
      };
    }

    const vvpq=critical?.actual?.vvpq;
    if(vvpq?.data_class==="ACTUAL"&&ageMinutes(vvpq.observed_at,nowMs)<=45){
      const weather=clean(vvpq.weather).toUpperCase();
      const raining=/\b(RA|SHRA|TSRA|DZ)\b/.test(weather);
      const thunder=/\bTS/.test(weather);
      if(raining){
        return {
          state:thunder?"NEARBY_ACTUAL_THUNDER_RAIN":"NEARBY_ACTUAL_RAIN",
          evidenceClass:"ACTUAL",
          headline:thunder?"Trạm gần khu vực đang ghi nhận mưa dông.":"Trạm gần khu vực đang ghi nhận mưa.",
          detail:"Mưa có thể không xảy ra đồng thời ở mọi nơi trên đảo.",
          observedAt:vvpq.observed_at||null
        };
      }
    }

    return {
      state:"NO_DIRECT_RAIN_CONFIRMATION",
      evidenceClass:"UNKNOWN",
      headline:"Chưa có số đo mưa mới ở khu vực này.",
      detail:"Chưa có số đo mới thì chưa nên kết luận trời đang khô.",
      observedAt:null
    };
  }

  function soonView(nowcast,pointId,nowMs=Date.now()){
    const sampled=nowcast?.sampled_time||null;
    if(!sampled||ageMinutes(sampled,nowMs)>60){
      return {
        state:"STALE",
        evidenceClass:"REMOTE_OBSERVED",
        headline:"Ảnh mây mới chưa về.",
        detail:"Tạm thời chưa đưa ra nhận định cho 30-120 phút tới.",
        observedAt:sampled
      };
    }

    const point=nowcast?.points?.[pointId]||{};
    const motion=point.cloud_motion||{};
    const score=num(point.score);
    const eta=num(motion.eta_minutes);
    const publicTrack=motion.public_track_usable===true;
    const impact=motion.predicted_impact===true;

    if(publicTrack&&impact&&eta!==null&&eta>=0&&eta<=120){
      let windowText="trong 1-2 giờ tới";
      let windowCode="60_120_MIN";
      if(eta<=30){windowText="trong khoảng 30 phút tới";windowCode="0_30_MIN"}
      else if(eta<=60){windowText="trong khoảng 30-60 phút tới";windowCode="30_60_MIN"}
      return {
        state:"APPROACHING_CONVECTION",
        evidenceClass:"DERIVED_NOWCAST",
        headline:"Một vùng mây phát triển mạnh đang tiến gần khu vực này.",
        detail:"Cần để ý khả năng mưa "+windowText+". Đây là diễn biến từ ảnh mây, chưa phải số đo mưa tại mặt đất.",
        observedAt:sampled,
        window:windowCode
      };
    }

    if(publicTrack&&motion.status==="MOVING_AWAY"){
      return {
        state:"MOVING_AWAY",
        evidenceClass:"DERIVED_NOWCAST",
        headline:"Vùng mây phát triển mạnh đang dịch ra xa khu vực này.",
        detail:"Đường đi hiện tại chưa cho thấy vùng mây đang tiến vào khu vực đang xem.",
        observedAt:sampled
      };
    }

    if(publicTrack&&motion.status==="PASSING_BY"){
      return {
        state:"PASSING_BY",
        evidenceClass:"DERIVED_NOWCAST",
        headline:"Một vùng mây phát triển mạnh đang đi ngang qua khu vực.",
        detail:"Đường đi hiện tại chưa cắt vào khu vực đang xem.",
        observedAt:sampled
      };
    }

    if(score!==null&&score>=75){
      return {
        state:"CONVECTIVE_WATCH",
        evidenceClass:"REMOTE_OBSERVED",
        headline:"Có vùng mây phát triển mạnh quanh khu vực.",
        detail:"Nên theo dõi thêm. Chưa đủ để nói mưa sẽ tới khu vực này.",
        observedAt:sampled
      };
    }

    return {
      state:"NO_STRONG_SHORT_SIGNAL",
      evidenceClass:"REMOTE_OBSERVED",
      headline:"Chưa thấy tín hiệu ngắn hạn đáng chú ý.",
      detail:"Mưa cục bộ vẫn có thể xuất hiện.",
      observedAt:sampled
    };
  }

  function pointView(critical,nowcast,pointId,nowMs=Date.now()){
    if(!pointId)return null;
    return {
      pointId,
      status:"PUBLIC_BETA",
      now:nowView(critical,pointId,nowMs),
      soon:soonView(nowcast,pointId,nowMs),
      policy:{
        v2DecisionAuthority:true,
        radarNegativeNeverMeansDry:true,
        preciseEtaDisabled:true,
        lightningPublicDisabled:true
      }
    };
  }

  return {ageMinutes,nowView,soonView,pointView};
});
