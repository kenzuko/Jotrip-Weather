(()=>{
  const API=(window.JOTRIP_WEATHER_LIVE_API_URL||'').replace(/\/$/,'');
  const QUEUE_KEY='jotrip-weather-feedback-queue:v1';
  const MAX_QUEUE=50;
  const state={verdict:null,wind:'unknown',wave:'unknown',rain:'unknown',evidence:'field_observation'};

  const txt=id=>document.getElementById(id)?.textContent?.trim()||null;
  const num=id=>{
    const raw=txt(id); if(!raw)return null;
    const m=raw.replace(',','.').match(/-?\d+(?:\.\d+)?/); return m?Number(m[0]):null;
  };
  const selectedPoint=()=>document.querySelector('.point-tabs button.active')?.dataset?.point||'unknown';
  const pointName=()=>document.querySelector('.point-tabs button.active')?.textContent?.trim()||selectedPoint();
  const readQueue=()=>{try{return JSON.parse(localStorage.getItem(QUEUE_KEY)||'[]')}catch{return []}};
  const writeQueue=items=>{try{localStorage.setItem(QUEUE_KEY,JSON.stringify(items.slice(-MAX_QUEUE)));return true}catch{return false}};
  const queuePayload=payload=>{const q=readQueue();q.push(payload);writeQueue(q)};
  const setStatus=(message,ok=false)=>{const el=document.querySelector('[data-feedback-status]');if(el){el.textContent=message;el.style.color=ok?'#2b7b50':'#627383'}};

  async function snapshotMeta(){
    try{
      const r=await fetch('/weather/dashboard-data.json',{cache:'no-store'});
      if(!r.ok)return {};
      const d=await r.json();
      return {snapshot_id:d.snapshot_id||null,generated_at:d.generated_at||null,source_cycles:d.source_cycles||{}};
    }catch{return {}}
  }

  async function send(payload){
    if(!API)throw new Error('feedback_api_unavailable');
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),3500);
    try{
      const r=await fetch(`${API}/feedback`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal:controller.signal});
      if(!r.ok)throw new Error(`feedback_http_${r.status}`);
      return await r.json();
    }finally{clearTimeout(timer)}
  }

  async function flushQueue(){
    if(!API)return;
    const q=readQueue(); if(!q.length)return;
    const remain=[];
    for(const item of q){
      try{await send(item)}catch{remain.push(item)}
    }
    writeQueue(remain);
  }

  function setGroup(selector,value,key){
    state[key]=value;
    document.querySelectorAll(selector).forEach(btn=>btn.classList.toggle('active',btn.dataset.value===value));
  }

  async function submit(){
    if(!state.verdict){setStatus('Chọn mức độ sát thực tế trước khi gửi.');return}
    const note=document.querySelector('[data-feedback-note]')?.value?.trim().slice(0,500)||'';
    const meta=await snapshotMeta();
    const payload={
      id:(crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(16).slice(2)}`),
      observed_at:new Date().toISOString(),
      point_id:selectedPoint(),
      point_name:pointName(),
      verdict:state.verdict,
      wind_relation:state.wind,
      wave_relation:state.wave,
      rain_relation:state.rain,
      evidence_type:state.evidence,
      note,
      snapshot_id:meta.snapshot_id||txt('snapshotId'),
      forecast_generated_at:meta.generated_at||null,
      source_cycles:meta.source_cycles||{},
      forecast:{
        temperature_c:num('temperatureMetric'),
        wind_kmh:num('wind'),
        gust_kmh:num('gust'),
        wave_hs_m:num('wave'),
        wave_hmax_m:num('waveMax'),
        rain_3h_mm:num('rain'),
        current_kmh:num('current')
      },
      ui_version:'field-feedback-v1'
    };
    const button=document.querySelector('[data-feedback-submit]'); if(button)button.disabled=true;
    setStatus('Đang gửi phản hồi...');
    try{
      await send(payload);
      setStatus('Đã ghi nhận. Cảm ơn anh em phản hồi thực tế.',true);
      if(button)button.textContent='Đã gửi';
    }catch{
      queuePayload(payload);
      setStatus('Đã lưu trên máy. Hệ thống sẽ tự gửi lại khi đường truyền ổn.',true);
      if(button)button.textContent='Đã lưu';
    }finally{if(button)setTimeout(()=>{button.disabled=false;button.textContent='Gửi phản hồi'},1800)}
  }

  function install(){
    if(document.querySelector('.feedback-panel'))return;
    const anchor=document.querySelector('.conditions'); if(!anchor)return;
    const section=document.createElement('section');
    section.className='feedback-panel panel';
    section.innerHTML=`
      <div class="panel-head premium-head"><div><small>PHẢN HỒI THỰC TẾ</small><h2>Dự báo có sát ngoài trời không?</h2></div><span class="section-kicker">30 giây</span></div>
      <p class="feedback-intro">Chọn cảm nhận thực tế tại điểm đang xem. Phản hồi này được lưu riêng để đối chiếu mô hình, không tự động đổi dự báo.</p>
      <div class="feedback-quick" data-feedback-verdict>
        <button type="button" data-value="accurate">Sát thực tế</button>
        <button type="button" data-value="close">Khá sát</button>
        <button type="button" data-value="wrong">Lệch rõ</button>
      </div>
      <div class="feedback-details" hidden>
        <div class="feedback-row"><strong>Gió</strong><div class="feedback-chips" data-feedback-wind><button class="feedback-chip" type="button" data-value="lower">Yếu hơn</button><button class="feedback-chip" type="button" data-value="about">Gần đúng</button><button class="feedback-chip" type="button" data-value="higher">Mạnh hơn</button></div></div>
        <div class="feedback-row"><strong>Sóng</strong><div class="feedback-chips" data-feedback-wave><button class="feedback-chip" type="button" data-value="lower">Thấp hơn</button><button class="feedback-chip" type="button" data-value="about">Gần đúng</button><button class="feedback-chip" type="button" data-value="higher">Cao hơn</button></div></div>
        <div class="feedback-row"><strong>Mưa</strong><div class="feedback-chips" data-feedback-rain><button class="feedback-chip" type="button" data-value="lower">Ít hơn</button><button class="feedback-chip" type="button" data-value="about">Gần đúng</button><button class="feedback-chip" type="button" data-value="higher">Nhiều hơn</button></div></div>
        <div class="feedback-row"><strong>Nguồn nhìn</strong><div class="feedback-source" data-feedback-evidence><button type="button" data-value="on_sea">Đang ở biển</button><button type="button" data-value="on_land">Trên bờ</button><button type="button" data-value="instrument">Có thiết bị đo</button></div></div>
        <textarea class="feedback-note" data-feedback-note maxlength="500" placeholder="Ghi chú ngắn nếu cần, ví dụ: An Thới 09:30 gió mạnh hơn dự báo, sóng gần đúng."></textarea>
        <div class="feedback-actions"><button class="feedback-submit" type="button" data-feedback-submit>Gửi phản hồi</button><span class="feedback-status" data-feedback-status></span></div>
        <p class="feedback-privacy">Không yêu cầu tên hay số điện thoại. Đây là quan sát hiện trường, không tự động được xem là số đo chuẩn để hiệu chỉnh mô hình.</p>
      </div>`;
    anchor.insertAdjacentElement('beforebegin',section);

    section.querySelectorAll('[data-feedback-verdict] button').forEach(btn=>btn.addEventListener('click',()=>{
      setGroup('[data-feedback-verdict] button',btn.dataset.value,'verdict');
      section.querySelector('.feedback-details').hidden=false;
    }));
    section.querySelectorAll('[data-feedback-wind] button').forEach(btn=>btn.addEventListener('click',()=>setGroup('[data-feedback-wind] button',btn.dataset.value,'wind')));
    section.querySelectorAll('[data-feedback-wave] button').forEach(btn=>btn.addEventListener('click',()=>setGroup('[data-feedback-wave] button',btn.dataset.value,'wave')));
    section.querySelectorAll('[data-feedback-rain] button').forEach(btn=>btn.addEventListener('click',()=>setGroup('[data-feedback-rain] button',btn.dataset.value,'rain')));
    section.querySelectorAll('[data-feedback-evidence] button').forEach(btn=>btn.addEventListener('click',()=>setGroup('[data-feedback-evidence] button',btn.dataset.value,'evidence')));
    section.querySelector('[data-feedback-submit]')?.addEventListener('click',submit);
    setGroup('[data-feedback-evidence] button','on_sea','evidence');
    flushQueue().catch(()=>{});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
  window.addEventListener('online',()=>flushQueue().catch(()=>{}));
})();
