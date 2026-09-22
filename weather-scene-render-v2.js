(()=>{"use strict";
let windRAF=null,particles=[];

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const num=v=>v===null||v===undefined||v===""||Number.isNaN(Number(v))?null:Number(v);
const FIELD_BOUNDS={south:9.72,north:10.57,west:103.62,east:104.38,fade:.07};

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
function between(v,a,b){return clamp((v-a)/(b-a),0,1)}
function fit(canvas,scale,map){
  const size=map?.getSize?.();
  const cssW=Math.max(1,Number(size?.x)||window.innerWidth);
  const cssH=Math.max(1,Number(size?.y)||window.innerHeight);
  canvas.width=Math.max(180,Math.round(cssW*scale));
  canvas.height=Math.max(220,Math.round(cssH*scale));
  canvas.style.width=cssW+"px";
  canvas.style.height=cssH+"px";
  canvas.style.left="0px";
  canvas.style.top="0px";
  return {w:canvas.width,h:canvas.height,sx:canvas.width/cssW,sy:canvas.height/cssH,cssW,cssH};
}
function project(rows,map,canvas,scale){
  const s=fit(canvas,scale,map);
  return (rows||[]).map(r=>{
    const p=map.latLngToLayerPoint([Number(r.lat),Number(r.lon)]);
    return {...r,x:p.x*s.sx,y:p.y*s.sy};
  }).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));
}
function grid(rows,key){
  const valid=(rows||[]).map(r=>({
    lat:num(r.lat),lon:num(r.lon),v:num(r[key])
  })).filter(r=>r.lat!==null&&r.lon!==null&&r.v!==null);
  if(!valid.length)return null;
  const lats=[...new Set(valid.map(r=>r.lat))].sort((a,b)=>a-b);
  const lons=[...new Set(valid.map(r=>r.lon))].sort((a,b)=>a-b);
  if(lats.length<2||lons.length<2)return null;
  const values=new Map(valid.map(r=>[r.lat.toFixed(5)+"|"+r.lon.toFixed(5),r.v]));
  return {
    lats,lons,values,
    dLat:(lats.at(-1)-lats[0])/(lats.length-1),
    dLon:(lons.at(-1)-lons[0])/(lons.length-1),
    lat0:lats[0],lat1:lats.at(-1),lon0:lons[0],lon1:lons.at(-1)
  };
}
function sampleGrid(g,lat,lon){
  if(!g||lat<g.lat0||lat>g.lat1||lon<g.lon0||lon>g.lon1)return null;
  const fy=(lat-g.lat0)/g.dLat,fx=(lon-g.lon0)/g.dLon;
  const y0=clamp(Math.floor(fy),0,g.lats.length-2),x0=clamp(Math.floor(fx),0,g.lons.length-2);
  const y1=y0+1,x1=x0+1,ty=clamp(fy-y0,0,1),tx=clamp(fx-x0,0,1);
  const get=(y,x)=>g.values.get(g.lats[y].toFixed(5)+"|"+g.lons[x].toFixed(5));
  const q=[
    [get(y0,x0),(1-tx)*(1-ty)],[get(y0,x1),tx*(1-ty)],
    [get(y1,x0),(1-tx)*ty],[get(y1,x1),tx*ty]
  ];
  let sw=0,sv=0;
  for(const [v,w] of q){if(Number.isFinite(v)){sw+=w;sv+=v*w}}
  return sw?sv/sw:null;
}
function edgeMask(lat,lon){
  const b=FIELD_BOUNDS,f=b.fade;
  if(lat<b.south||lat>b.north||lon<b.west||lon>b.east)return 0;
  const ds=Math.min(lat-b.south,b.north-lat,lon-b.west,b.east-lon);
  return clamp(ds/f,0,1);
}
function withAlpha(col,a){
  if(!col||!col[3]||a<=0)return [0,0,0,0];
  return [col[0],col[1],col[2],Math.round(col[3]*a)];
}
function alphaOver(base,top){
  const ba=(base?.[3]||0)/255,ta=(top?.[3]||0)/255,oa=ta+ba*(1-ta);
  if(oa<=0)return [0,0,0,0];
  return [
    Math.round((top[0]*ta+base[0]*ba*(1-ta))/oa),
    Math.round((top[1]*ta+base[1]*ba*(1-ta))/oa),
    Math.round((top[2]*ta+base[2]*ba*(1-ta))/oa),
    Math.round(oa*255)
  ];
}
function cloudBody(c){
  if(c===null||c>8)return [0,0,0,0];
  if(c>-8){
    const t=between(c,8,-8),rgb=ramp([[0,[229,234,236]],[1,[239,245,247]]],t);
    return [...rgb,Math.round((.025+t*.07)*255)];
  }
  if(c>-18){
    const t=between(c,-8,-18),rgb=ramp([[0,[239,245,247]],[1,[220,237,243]]],t);
    return [...rgb,Math.round((.09+t*.10)*255)];
  }
  if(c>-28){
    const t=between(c,-18,-28),rgb=ramp([[0,[220,237,243]],[1,[175,213,229]]],t);
    return [...rgb,Math.round((.19+t*.10)*255)];
  }
  const t=between(c,-28,-45),rgb=ramp([[0,[175,213,229]],[1,[139,194,219]]],t);
  return [...rgb,Math.round((.29+t*.09)*255)];
}
function cloudCore(c){
  if(c===null||c>-38)return [0,0,0,0];
  const t=clamp((-c-38)/40,0,1),rgb=ramp([
    [0,[103,184,219]],[.28,[74,170,213]],[.50,[88,194,160]],
    [.68,[220,205,91]],[.84,[235,137,68]],[1,[187,67,84]]
  ],t);
  return [...rgb,Math.round((.16+t*.48)*255)];
}
function rainColor(mm){
  if(mm===null||mm<.06)return [0,0,0,0];
  const t=clamp(Math.log1p(mm)/Math.log(31),0,1),rgb=ramp([
    [0,[83,160,211]],[.25,[61,187,207]],[.45,[64,176,139]],
    [.65,[211,199,88]],[.82,[232,144,61]],[.93,[207,80,80]],[1,[158,68,111]]
  ],t);
  return [...rgb,Math.round((.06+Math.pow(t,.72)*.54)*255)];
}
function waveColor(hs){
  if(hs===null||hs<.05)return [0,0,0,0];
  const t=clamp(hs/1.8,0,1),rgb=ramp([
    [0,[222,242,245]],[.15,[164,218,225]],[.30,[99,188,203]],
    [.48,[55,151,181]],[.66,[46,108,163]],[.84,[72,75,143]],[1,[96,47,124]]
  ],t);
  return [...rgb,Math.round((.10+.48*Math.pow(t,.68))*255)];
}
function stop(){
  if(windRAF)cancelAnimationFrame(windRAF);
  windRAF=null;particles=[];
}
function clear(canvas){
  if(canvas)canvas.getContext("2d").clearRect(0,0,canvas.width,canvas.height);
}
function raster(scene,rows,map,field,motion){
  stop();clear(motion);
  const scale=innerWidth<760?.58:.50,s=fit(field,scale,map);
  const ctx=field.getContext("2d");ctx.clearRect(0,0,s.w,s.h);

  const body=scene==="cloud"?grid(rows,"cloud_top_median_c"):null;
  const core=scene==="cloud"?grid(rows,"cloud_top_cold_c"):null;
  const scalar=scene==="rain"?grid(rows,"rain_mm"):scene==="wave"?grid(rows,"wave_hs_m"):null;
  if(scene==="cloud"&&!body&&!core)return s;
  if(scene!=="cloud"&&!scalar)return s;

  const lons=new Float64Array(s.w),lats=new Float64Array(s.h);
  for(let x=0;x<s.w;x++)lons[x]=map.layerPointToLatLng([x/s.sx,0]).lng;
  for(let y=0;y<s.h;y++)lats[y]=map.layerPointToLatLng([0,y/s.sy]).lat;

  const img=ctx.createImageData(s.w,s.h);
  for(let y=0;y<s.h;y++){
    const lat=lats[y];
    for(let x=0;x<s.w;x++){
      const lon=lons[x],mask=edgeMask(lat,lon);
      let col=[0,0,0,0];
      if(mask>0){
        if(scene==="cloud"){
          col=alphaOver(cloudBody(sampleGrid(body,lat,lon)),cloudCore(sampleGrid(core,lat,lon)));
        }else{
          const v=sampleGrid(scalar,lat,lon);
          col=scene==="rain"?rainColor(v):waveColor(v);
        }
        col=withAlpha(col,mask);
      }
      const k=(y*s.w+x)*4;
      img.data[k]=col[0];img.data[k+1]=col[1];img.data[k+2]=col[2];img.data[k+3]=col[3];
    }
  }
  ctx.putImageData(img,0,0);
  return s;
}
function wave(rows,map,field,motion){
  const s=raster("wave",rows,map,field,motion);
  if(!s)return;
  const ctx=field.getContext("2d");
  const pts=project(rows,map,field,innerWidth<760?.58:.50)
    .filter(p=>num(p.wave_hs_m)!==null&&num(p.wave_direction_deg)!==null&&edgeMask(Number(p.lat),Number(p.lon))>.35)
    .filter(p=>p.x>=0&&p.y>=0&&p.x<=field.width&&p.y<=field.height);
  ctx.save();
  pts.forEach((p,i)=>{
    const every=innerWidth<760?4:2;
    if(i%every!==0)return;
    const hs=num(p.wave_hs_m)||0,t=clamp(hs/1.8,0,1);
    const toDeg=((num(p.wave_direction_deg)||0)+180)%360,ang=(toDeg-90)*Math.PI/180,len=6+t*7;
    const x0=p.x-Math.cos(ang)*len*.4,y0=p.y-Math.sin(ang)*len*.4;
    const x1=p.x+Math.cos(ang)*len*.6,y1=p.y+Math.sin(ang)*len*.6;
    ctx.strokeStyle="rgba(18,64,91,"+(.30+t*.32).toFixed(3)+")";
    ctx.fillStyle="rgba(18,64,91,"+(.36+t*.32).toFixed(3)+")";
    ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(x0,y0);ctx.lineTo(x1,y1);ctx.stroke();
    const ah=3+t*1.5,side=.65;
    ctx.beginPath();ctx.moveTo(x1,y1);
    ctx.lineTo(x1-Math.cos(ang-side)*ah,y1-Math.sin(ang-side)*ah);
    ctx.lineTo(x1-Math.cos(ang+side)*ah,y1-Math.sin(ang+side)*ah);
    ctx.closePath();ctx.fill();

    if(innerWidth>=760||i%(every*2)===0){
      ctx.font="600 7px system-ui,-apple-system,sans-serif";
      ctx.textAlign="center";ctx.textBaseline="middle";
      ctx.lineWidth=2;ctx.strokeStyle="rgba(255,255,255,.8)";ctx.fillStyle="rgba(20,61,80,.78)";
      const label=hs.toFixed(1)+" m",ly=p.y+11;
      ctx.strokeText(label,p.x,ly);ctx.fillText(label,p.x,ly);
    }
  });
  ctx.restore();
}
function windVectors(rows,map,canvas){
  return project(rows,map,canvas,innerWidth<760?.58:.50).map(p=>({
    x:p.x,y:p.y,u:num(p.u10_ms),v:num(p.v10_ms),mag:Math.hypot(num(p.u10_ms)||0,num(p.v10_ms)||0),
    lat:num(p.lat),lon:num(p.lon)
  })).filter(p=>p.u!==null&&p.v!==null&&edgeMask(p.lat,p.lon)>.25);
}
function vectorAt(x,y,pv){
  const nearest=[];
  for(const p of pv){
    const d2=(x-p.x)*(x-p.x)+(y-p.y)*(y-p.y)+10;
    let k=0;while(k<nearest.length&&nearest[k].d2<d2)k++;
    nearest.splice(k,0,{p,d2});if(nearest.length>4)nearest.pop();
  }
  let sw=0,u=0,v=0,mag=0;
  for(const n of nearest){const w=1/n.d2;sw+=w;u+=n.p.u*w;v+=n.p.v*w;mag+=n.p.mag*w}
  return sw?{u:u/sw,v:v/sw,mag:mag/sw}:null;
}
function wind(rows,map,field,motion){
  stop();clear(field);
  fit(field,innerWidth<760?.58:.50,map);
  fit(motion,innerWidth<760?.58:.50,map);
  const ctx=motion.getContext("2d");ctx.clearRect(0,0,motion.width,motion.height);
  const pv=windVectors(rows,map,motion);
  if(!pv.length)return;
  const count=innerWidth<760?58:105;
  particles=Array.from({length:count},()=>({x:Math.random()*motion.width,y:Math.random()*motion.height,age:Math.random()*80}));
  const tick=()=>{
    ctx.clearRect(0,0,motion.width,motion.height);ctx.lineCap="round";
    for(const p of particles){
      const n=vectorAt(p.x,p.y,pv);
      if(!n){p.age=999}
      else{
        const m=Math.max(.001,Math.hypot(n.u,n.v)),ux=n.u/m,uy=-n.v/m;
        const speed=.50+clamp(n.mag/8,0,1)*1.45,ox=p.x,oy=p.y;
        p.x+=ux*speed;p.y+=uy*speed;p.age++;
        if(p.x>=0&&p.y>=0&&p.x<=motion.width&&p.y<=motion.height&&p.age<=110){
          const strength=clamp(n.mag/12,0,1);
          ctx.strokeStyle="rgba(17,70,92,"+(.18+strength*.28).toFixed(3)+")";
          ctx.fillStyle="rgba(17,70,92,"+(.30+strength*.30).toFixed(3)+")";
          ctx.lineWidth=.65;
          ctx.beginPath();ctx.moveTo(ox+(p.x-ox)*.55,oy+(p.y-oy)*.55);ctx.lineTo(p.x,p.y);ctx.stroke();
          ctx.beginPath();ctx.arc(p.x,p.y,.5+strength*.5,0,Math.PI*2);ctx.fill();
          continue;
        }
      }
      const seed=pv[Math.floor(Math.random()*pv.length)];
      p.x=seed?seed.x:Math.random()*motion.width;
      p.y=seed?seed.y:Math.random()*motion.height;
      p.age=0;
    }
    windRAF=requestAnimationFrame(tick);
  };
  tick();
}
function render({scene,rows,map,fieldCanvas,motionCanvas}){
  if(!map||!fieldCanvas||!motionCanvas)return;
  if(scene==="cloud"||scene==="rain")raster(scene,rows,map,fieldCanvas,motionCanvas);
  else if(scene==="wave")wave(rows,map,fieldCanvas,motionCanvas);
  else if(scene==="wind")wind(rows,map,fieldCanvas,motionCanvas);
}

window.JoTripSceneRenderer={version:"3.0-continuous-field-island-first",render,stop};
})();