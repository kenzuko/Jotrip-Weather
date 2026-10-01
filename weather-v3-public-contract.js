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
        headline:clean(item.headline)||"Đang có mưa tại điểm quan trắc.",
        detail:clean(item.detail)||"Quan trắc thực tế đang ghi nhận mưa tại khu vực này.",
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
          headline:thunder?"Quan trắc gần đảo đang ghi nhận mưa dông.":"Quan trắc gần đảo đang ghi nhận mưa.",
          detail:"Đây là quan trắc tại trạm tham chiếu, không có nghĩa mọi khu vực trên đảo đều đang mưa.",
          observedAt:vvpq.observed_at||null
        };
      }
    }

    return {
      state:"NO_DIRECT_RAIN_CONFIRMATION",
      evidenceClass:"UNKNOWN",
      headline:"Chưa có quan trắc mưa trực tiếp mới tại điểm này.",
      detail:"Hệ thống không dùng dữ liệu thiếu để kết luận là trời đang khô.",
      observedAt:null
    };
  }

  function soonView(nowcast,pointId,nowMs=Date.now()){
    const sampled=nowcast?.sampled_time||null;
    if(!sampled||ageMinutes(sampled,nowMs)>75){
      return {
        state:"STALE",
        evidenceClass:"REMOTE_OBSERVED",
        headline:"Chưa đủ dữ liệu mới cho dự báo cực ngắn.",
        detail:"Ảnh vệ tinh đang trễ hoặc chưa có dữ liệu phù hợp.",
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
        headline:"Có vùng mây đối lưu đang tiến gần khu vực này.",
        detail:"Cần theo dõi mưa dông "+windowText+". Đây là suy luận từ vệ tinh, chưa phải mưa đo tại mặt đất.",
        observedAt:sampled,
        window:windowCode
      };
    }

    if(publicTrack&&motion.status==="MOVING_AWAY"){
      return {
        state:"MOVING_AWAY",
        evidenceClass:"DERIVED_NOWCAST",
        headline:"Vùng mây đối lưu đang dịch ra xa điểm này.",
        detail:"Tín hiệu vệ tinh hiện chưa cho thấy vùng mây đang tiến vào điểm đang xem.",
        observedAt:sampled
      };
    }

    if(publicTrack&&motion.status==="PASSING_BY"){
      return {
        state:"PASSING_BY",
        evidenceClass:"DERIVED_NOWCAST",
        headline:"Vùng mây đối lưu đang đi ngang khu vực.",
        detail:"Hiện chưa có đường đi đủ rõ để nói vùng mây sẽ cắt vào điểm đang xem.",
        observedAt:sampled
      };
    }

    if(score!==null&&score>=75){
      return {
        state:"CONVECTIVE_WATCH",
        evidenceClass:"REMOTE_OBSERVED",
        headline:"Có mây đối lưu đáng chú ý quanh khu vực.",
        detail:"Tiếp tục theo dõi diễn biến ngắn hạn. Chưa đủ dữ liệu để kết luận mưa sẽ tới điểm này.",
        observedAt:sampled
      };
    }

    return {
      state:"NO_STRONG_SHORT_SIGNAL",
      evidenceClass:"REMOTE_OBSERVED",
      headline:"Chưa có tín hiệu ngắn hạn đủ mạnh để phát cảnh báo.",
      detail:"Điều này không đồng nghĩa chắc chắn sẽ không có mưa cục bộ.",
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
