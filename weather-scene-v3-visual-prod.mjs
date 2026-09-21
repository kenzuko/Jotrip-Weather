// rerun after duplicate render path removal
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';

const target='https://weather.openphuquoc.com/weather-scene-v3.html?visualqa='+Date.now();
const result={target,ok:false,scenes:{},runtime:{},pageErrors:[],consoleErrors:[],failure:null};

const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2});
page.on('pageerror',e=>result.pageErrors.push(String(e)));
page.on('console',m=>{if(m.type()==='error')result.consoleErrors.push(m.text());});

async function sampleComposite(){
  return page.locator('.map-shell').screenshot({type:'png'});
}
async function measureCanvas(sel){
  return page.locator(sel).evaluate(canvas=>{
    const cs=getComputedStyle(canvas);
    const r=canvas.getBoundingClientRect();
    return {
      width:canvas.width,height:canvas.height,
      cssWidth:r.width,cssHeight:r.height,
      display:cs.display,visibility:cs.visibility,opacity:cs.opacity,zIndex:cs.zIndex,
      parent:canvas.parentElement?.id||canvas.parentElement?.className||null
    };
  });
}
async function measurePaint(sel){
  return page.locator(sel).evaluate(canvas=>{
    const ctx=canvas.getContext('2d');
    const {data}=ctx.getImageData(0,0,canvas.width,canvas.height);
    let alphaPixels=0,sumAlpha=0,maxAlpha=0;
    for(let i=3;i<data.length;i+=4){
      const a=data[i];
      if(a>4) alphaPixels++;
      sumAlpha+=a;
      if(a>maxAlpha) maxAlpha=a;
    }
    const total=Math.max(1,data.length/4);
    return {
      alphaPixels,
      coverage:alphaPixels/total,
      meanAlpha:sumAlpha/total,
      maxAlpha
    };
  });
}
async function seekPaint(scene){
  const targetSel=scene==='wind'?'#motionCanvas':'#fieldCanvas';
  const slider=page.locator('#slider');
  const max=Number(await slider.getAttribute('max')||0);
  const cur=Number(await slider.inputValue()||0);
  const tries=[cur,0,Math.floor(max/2),max].filter((v,i,a)=>v>=0&&a.indexOf(v)===i);
  let best=null;
  for(const v of tries){
    await slider.evaluate((el,value)=>{
      el.value=String(value);
      el.dispatchEvent(new Event('input',{bubbles:true}));
    },v);
    await page.waitForTimeout(scene==='wind'?900:450);
    const paint=await measurePaint(targetSel);
    if(!best||paint.alphaPixels>best.paint.alphaPixels) best={index:v,paint};
    if(paint.alphaPixels>40&&paint.maxAlpha>8) return {index:v,paint};
  }
  return best;
}

try{
  await page.goto(target,{waitUntil:'domcontentloaded',timeout:120000});
  await page.waitForFunction(()=>document.getElementById('loading')?.classList.contains('hidden'),{timeout:120000});
  await page.waitForTimeout(1500);
  result.runtime=await page.evaluate(()=>({
    scripts:[...document.scripts].map(s=>s.src),
    rendererLoaded:!!window.JoTripSceneRenderer,
    rendererKeys:window.JoTripSceneRenderer?Object.keys(window.JoTripSceneRenderer):[],
    rendererVersion:window.JoTripSceneRenderer?.version||null,
    appScript:[...document.scripts].map(s=>s.src).find(x=>x.includes('weather-scene-v3.js'))||null,
    renderScript:[...document.scripts].map(s=>s.src).find(x=>x.includes('weather-scene-render-v2.js'))||null
  }));

  for(const scene of ['cloud','rain','wind','wave']){
    await page.locator('.tabs button[data-scene="'+scene+'"]').click();
    await page.waitForTimeout(scene==='wind'?1200:700);
    const paintSeek=await seekPaint(scene);
    const fieldPaint=await measurePaint('#fieldCanvas');
    const motionPaint=await measurePaint('#motionCanvas');

    const before=await sampleComposite();
    await writeFile('/tmp/'+scene+'-visible.png',before);

    await page.evaluate(()=>{
      document.getElementById('fieldCanvas').style.visibility='hidden';
      document.getElementById('motionCanvas').style.visibility='hidden';
    });
    await page.waitForTimeout(150);
    const hidden=await sampleComposite();
    await writeFile('/tmp/'+scene+'-hidden.png',hidden);

    await page.evaluate(()=>{
      document.getElementById('fieldCanvas').style.visibility='visible';
      document.getElementById('motionCanvas').style.visibility='visible';
    });

    result.scenes[scene]={
      field:await measureCanvas('#fieldCanvas'),
      motion:await measureCanvas('#motionCanvas'),
      time:(await page.locator('#timeLabel').innerText()).trim(),
      meta:(await page.locator('#timeMeta').innerText()).trim(),
      selectedFrame:paintSeek?.index??null,
      fieldPaint,
      motionPaint,
      visiblePngBytes:before.length,
      hiddenPngBytes:hidden.length,
      pngDeltaBytes:Math.abs(before.length-hidden.length)
    };
  }

  const scenePaintOk=Object.entries(result.scenes).every(([scene,s])=>{
    const paint=scene==='wind'?s.motionPaint:s.fieldPaint;
    return paint.alphaPixels>40 && paint.maxAlpha>8;
  });
  const compositeOk=Object.values(result.scenes).every(s=>s.pngDeltaBytes>500);
  result.ok=
    result.runtime.rendererLoaded===true &&
    String(result.runtime.renderScript||'').includes('weather-scene-render-v2.js') &&
    scenePaintOk &&
    compositeOk &&
    result.pageErrors.length===0;
}catch(e){result.failure=String(e?.stack||e)}

await writeFile('/tmp/weather-scene-v3-visual.json',JSON.stringify(result,null,2)+'\n','utf8');
console.log(JSON.stringify(result,null,2));
await browser.close();
if(!result.ok)process.exitCode=1;
