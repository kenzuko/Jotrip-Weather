(()=>{"use strict";
let windRAF=null,particles=[];

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const num=v=>v===null||v===undefined||v===""||Number.isNaN(Number(v))?null:Number(v);

function ramp(stops,t){
  t=clamp(t,0,1);
  for(let i=1;i<stops.length;i++){
    if(t<=stops[i][0]){
      const a=stops[i-1],b=stops[i],q=(t-a[0])/Math.max(.0001,b[0]-a[0]);
      return a[1].map((v,k)=>Math.round(v+(b[1][k]-v)*q));
    }
  }
  return stops.at(-1)[1];
}
function fit(canvas,scale,map){
  const size=map?.getSize?.();
  const cssW=Math.max(1,Number(size?.x)||canvas.parentElement?.parentElement?.clientWidth||window.innerWidth);
  const cssH=Math.max(1,Number(size?.y)||canvas.parentElement?.parentElement?.clientHeight||window.innerHeight);
  canvas.width=Math.max(180,Math.round(cssW*scale));
  canvas.height=Math.max(220,Math.round(cssH*scale));
  canvas.style.width=cssW+"px";
  canvas.style.height=cssH+"px";
  canvas.style.left="0px";
  canvas.style.top="0px";
  return {sx:canvas.width/cssW,sy:canvas.height/cssH};
}
function project(rows,map,canvas,scale){
  const s=fit(canvas,scale,map);
  return (rows||[]).map(r=>{
    const p=map.latLngToLayerPoint([Number(r.lat),Number(r.lon)]);
    return {...r,x:p.x*s.sx,y:p.y*s.sy};
  }).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));
}
function median(a){
  const v=a.filter(Number.isFinite).sort((x,y)=>x-y);
  if(!v.length)return 0;
  const m=Math.floor(v.length/2);
  return v.length%2?v[m]:(v[m-1]+v[m])/2;
}
function spacing(pts){
  if(pts.length<3)return 28;
  const ds=[];
  for(let i=0;i<pts.length;i++){
    let best=Infinity;
    for(let j=0;j<pts.length;j++){
      if(i===j)continue;
      best=Math.min(best,Math.hypot(pts[i].x-pts[j].x,pts[i].y-pts[j].y));
    }
    if(Number.isFinite(best))ds.push(best);
  }
  return clamp(median(ds),10,80);
}
function coldRgb(cold){
  const t=clamp((-cold-38)/38,0,1);
  return ramp([
    [0,[99,184,221]],[.28,[72,174,215]],[.50,[86,199,163]],
    [.68,[226,211,89]],[.84,[238,142,70]],[1,[191,67,84]]
  ],t);
}
function rainRgb(mm){
  const t=clamp(Math.log1p(Math.max(0,mm))/Math.log(31),0,1);
  return ramp([
    [0,[90,166,216]],[.25,[64,193,213]],[.45,[60,186,145]],
    [.65,[219,208,90]],[.82,[239,153,64]],[.93,[217,88,87]],[1,[168,73,120]]
  ],t);
}
function waveRgb(hs){
  const t=clamp(hs/1.8,0,1);
  return ramp([
    [0,[230,246,248]],
    [.14,[184,229,233]],
    [.25,[121,205,215]],
    [.36,[67,174,197]],
    [.50,[43,135,181]],
    [.67,[47,97,163]],
    [.89,[78,69,145]],
    [1,[106,48,128]]
  ],t);
}
function stop(){
  if(windRAF)cancelAnimationFrame(windRAF);
  windRAF=null;particles=[];
}
function clear(canvas){
  if(!canvas)return;
  canvas.getContext("2d").clearRect(0,0,canvas.width,canvas.height);
}
function cloud(rows,map,field,motion){
  stop();clear(motion);
  const pts=project(rows,map,field,innerWidth<760?.52:.44);
  const ctx=field.getContext("2d");ctx.clearRect(0,0,field.width,field.height);
  if(!pts.length)return;
  const r0=clamp(spacing(pts)*1.38,18,72);
  ctx.save();
  for(const p of pts){
    const med=num(p.cloud_top_median_c),cold=num(p.cloud_top_cold_c),high=num(p.cloud_top_high_m);
    if(med===null&&cold===null&&high===null)continue;
    const presence=clamp(.06+(med===null?0:clamp((-med-1)/40,0,1)*.38)+(high===null?0:clamp((high-1800)/10000,0,1)*.36),0,.75);
    if(presence>.09){
      const cool=med===null?0:clamp((-med-10)/32,0,1);
      const rgb=ramp([[0,[235,240,242]],[1,[176,214,230]]],cool);
      const a=clamp(.08+presence*.34,.08,.35),r=r0*(.90+presence*.36);
      const g=ctx.createRadialGradient(p.x,p.y,r*.08,p.x,p.y,r);
      g.addColorStop(0,`rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a.toFixed(3)})`);
      g.addColorStop(.56,`rgba(${rgb[0]},${rgb[1]},${rgb[2]},${(a*.72).toFixed(3)})`);
      g.addColorStop(1,`rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
      ctx.fillStyle=g;ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.fill();
    }
    if(cold!==null&&cold<=-38){
      const rgb=coldRgb(cold),t=clamp((-cold-38)/38,0,1),a=.24+t*.50,r=r0*(.45+t*.30);
      const g=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,r);
      g.addColorStop(0,`rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a.toFixed(3)})`);
      g.addColorStop(.46,`rgba(${rgb[0]},${rgb[1]},${rgb[2]},${(a*.72).toFixed(3)})`);
      g.addColorStop(1,`rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
      ctx.fillStyle=g;ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.fill();
    }
  }
  ctx.restore();
}
function rain(rows,map,field,motion){
  stop();clear(motion);
  const pts=project(rows,map,field,innerWidth<760?.58:.50).filter(p=>num(p.rain_mm)!==null&&num(p.rain_mm)>=.05);
  const ctx=field.getContext("2d");ctx.clearRect(0,0,field.width,field.height);
  if(!pts.length)return;
  const r0=clamp(spacing(pts)*1.46,18,78);
  ctx.save();
  for(const p of pts){
    const mm=num(p.rain_mm)||0,t=clamp(Math.log1p(mm)/Math.log(31),0,1),rgb=rainRgb(mm),a=.18+t*.64,r=r0*(.90+t*.44);
    const g=ctx.createRadialGradient(p.x,p.y,r*.06,p.x,p.y,r);
    g.addColorStop(0,`rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a.toFixed(3)})`);
    g.addColorStop(.52,`rgba(${rgb[0]},${rgb[1]},${rgb[2]},${(a*.68).toFixed(3)})`);
    g.addColorStop(1,`rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
    ctx.fillStyle=g;ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.fill();
  }
  ctx.restore();
}
function wave(rows,map,field,motion){
  stop();clear(motion);
  const pts=project(rows,map,field,innerWidth<760?.56:.48)
    .filter(p=>num(p.wave_hs_m)!==null&&num(p.wave_hs_m)>=.05);
  const ctx=field.getContext("2d");ctx.clearRect(0,0,field.width,field.height);
  if(!pts.length)return;
  const r0=clamp(spacing(pts)*1.22,17,66);
  ctx.save();
  pts.forEach((p,i)=>{
    const hs=num(p.wave_hs_m)||0,t=clamp(hs/1.8,0,1),rgb=waveRgb(hs),a=.20+Math.pow(t,.62)*.56,r=r0*(.90+t*.22);
    const g=ctx.createRadialGradient(p.x,p.y,r*.05,p.x,p.y,r);
    g.addColorStop(0,`rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a.toFixed(3)})`);
    g.addColorStop(.58,`rgba(${rgb[0]},${rgb[1]},${rgb[2]},${(a*.68).toFixed(3)})`);
    g.addColorStop(1,`rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
    ctx.fillStyle=g;ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.fill();

    const deg=num(p.wave_direction_deg);
    const drawArrow=deg!==null && (innerWidth<760 ? i%2===0 : true);
    if(drawArrow){
      const ang=(deg-90)*Math.PI/180,len=7+t*8;
      const x0=p.x-Math.cos(ang)*len*.42,y0=p.y-Math.sin(ang)*len*.42;
      const x1=p.x+Math.cos(ang)*len*.58,y1=p.y+Math.sin(ang)*len*.58;
      ctx.strokeStyle=`rgba(18,64,91,${(.42+t*.38).toFixed(3)})`;
      ctx.fillStyle=`rgba(18,64,91,${(.46+t*.38).toFixed(3)})`;
      ctx.lineWidth=1.15;
      ctx.beginPath();ctx.moveTo(x0,y0);ctx.lineTo(x1,y1);ctx.stroke();
      const ah=3.2+t*1.8,side=.65;
      ctx.beginPath();
      ctx.moveTo(x1,y1);
      ctx.lineTo(x1-Math.cos(ang-side)*ah,y1-Math.sin(ang-side)*ah);
      ctx.lineTo(x1-Math.cos(ang+side)*ah,y1-Math.sin(ang+side)*ah);
      ctx.closePath();ctx.fill();
    }

    const labelEvery=innerWidth<760?3:2;
    if(i%labelEvery===0){
      const label=hs.toFixed(1)+" m";
      ctx.save();
      ctx.font="600 7px system-ui,-apple-system,sans-serif";
      ctx.textAlign="center";
      ctx.textBaseline="middle";
      ctx.lineWidth=2.2;
      ctx.strokeStyle="rgba(255,255,255,.78)";
      ctx.fillStyle="rgba(20,61,80,.78)";
      const ly=p.y+11;
      ctx.strokeText(label,p.x,ly);
      ctx.fillText(label,p.x,ly);
      ctx.restore();
    }
  });
  ctx.restore();
}
function windVectors(rows,map,canvas){
  return project(rows,map,canvas,innerWidth<760?.58:.50).map(p=>({
    x:p.x,y:p.y,u:num(p.u10_ms),v:num(p.v10_ms),mag:Math.hypot(num(p.u10_ms)||0,num(p.v10_ms)||0)
  })).filter(p=>p.u!==null&&p.v!==null);
}
function vectorAt(x,y,pv){
  const nearest=[];
  for(const p of pv){
    const d2=(x-p.x)*(x-p.x)+(y-p.y)*(y-p.y)+10;
    let k=0;while(k<nearest.length&&nearest[k].d2<d2)k++;
    nearest.splice(k,0,{p,d2});if(nearest.length>4)nearest.pop();
  }
  let sw=0,u=0,v=0,mag=0;
  for(const n of nearest){const w=1/n.d2;sw+=w;u+=n.p.u*w;v+=n.p.v*w;mag+=n.p.mag*w;}
  return sw?{u:u/sw,v:v/sw,mag:mag/sw}:null;
}
function wind(rows,map,field,motion){
  stop();
  fit(field,innerWidth<760?.58:.50,map);fit(motion,innerWidth<760?.58:.50,map);
  const fctx=field.getContext("2d"),mctx=motion.getContext("2d");
  fctx.clearRect(0,0,field.width,field.height);
  mctx.clearRect(0,0,motion.width,motion.height);

  // Wind is expressed only by moving particles - no fixed dash/grid texture.
  const pv2=windVectors(rows,map,motion);
  if(!pv2.length)return;
  const count=innerWidth<760?68:112;
  particles=Array.from({length:count},()=>({x:Math.random()*motion.width,y:Math.random()*motion.height,age:Math.random()*80}));
  const tick=()=>{
    mctx.clearRect(0,0,motion.width,motion.height);mctx.lineCap="round";
    for(const p of particles){
      const n=vectorAt(p.x,p.y,pv2);if(!n)continue;
      const m=Math.max(.001,Math.hypot(n.u,n.v)),ux=n.u/m,uy=-n.v/m,speed=.55+clamp(n.mag/8,0,1)*1.7,ox=p.x,oy=p.y;
      p.x+=ux*speed;p.y+=uy*speed;p.age++;
      if(p.x<0||p.y<0||p.x>motion.width||p.y>motion.height||p.age>110){p.x=Math.random()*motion.width;p.y=Math.random()*motion.height;p.age=0;continue;}
      const strength=clamp(n.mag/12,0,1);
      mctx.strokeStyle=`rgba(17,70,92,${(.20+strength*.30).toFixed(3)})`;
      mctx.fillStyle=`rgba(17,70,92,${(.34+strength*.34).toFixed(3)})`;
      mctx.lineWidth=.65;
      mctx.beginPath();
      mctx.moveTo(ox+(p.x-ox)*.55,oy+(p.y-oy)*.55);
      mctx.lineTo(p.x,p.y);
      mctx.stroke();
      mctx.beginPath();
      mctx.arc(p.x,p.y,.55+strength*.55,0,Math.PI*2);
      mctx.fill();
    }
    windRAF=requestAnimationFrame(tick);
  };
  tick();
}
function render({scene,rows,map,fieldCanvas,motionCanvas}){
  if(!map||!fieldCanvas||!motionCanvas)return;
  if(scene==="cloud")cloud(rows,map,fieldCanvas,motionCanvas);
  else if(scene==="rain")rain(rows,map,fieldCanvas,motionCanvas);
  else if(scene==="wave")wave(rows,map,fieldCanvas,motionCanvas);
  else if(scene==="wind")wind(rows,map,fieldCanvas,motionCanvas);
}

window.JoTripSceneRenderer={version:"1.9-wave-readable",render,stop};
})();