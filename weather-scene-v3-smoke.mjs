import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';

const result={ok:false,scenes:{},runtime:null,pageErrors:[],consoleErrors:[],flag:false,failure:null};
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2});
page.on('pageerror',e=>result.pageErrors.push(String(e)));
page.on('console',m=>{if(m.type()==='error')result.consoleErrors.push(m.text());});

async function stats(sel){
  return page.locator(sel).evaluate(canvas=>{
    if(!(canvas instanceof HTMLCanvasElement)||!canvas.width||!canvas.height)return{w:0,h:0,samples:0,visible:0,strong:0,meanAlpha:0};
    const d=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    let samples=0,visible=0,strong=0,sum=0;
    for(let i=3;i<d.length;i+=32){
      const a=d[i];samples++;sum+=a;
      if(a>8)visible++;
      if(a>40)strong++;
    }
    return{w:canvas.width,h:canvas.height,samples,visible,strong,meanAlpha:samples?sum/samples:0};
  });
}
async function windMotionStats(){
  const frames=[];
  for(let i=0;i<5;i++){
    frames.push(await stats('#motionCanvas'));
    await page.waitForTimeout(180);
  }
  return {
    frames,
    maxVisible:Math.max(...frames.map(x=>x.visible||0)),
    maxStrong:Math.max(...frames.map(x=>x.strong||0)),
    maxMeanAlpha:Math.max(...frames.map(x=>x.meanAlpha||0))
  };
}
try{
  await page.goto('http://127.0.0.1:4173/weather-scene-v3.html',{waitUntil:'domcontentloaded',timeout:120000});
  await page.waitForFunction(()=>document.getElementById('loading')?.classList.contains('hidden'),{timeout:120000});
  await page.waitForTimeout(1200);

  const manifest=await page.evaluate(async()=>{const r=await fetch('/data/weather-runtime/manifest.json',{cache:'no-store'});return r.json()});
  const cloudTime=manifest.source_times?.cloud_sampled_time;
  result.runtime={cloudTime,cloudAgeMin:cloudTime?(Date.now()-Date.parse(cloudTime))/60000:null};
  for(const scene of ['cloud','rain','wind','wave']){
    if(scene==='cloud'&&await page.locator('.tabs button[data-scene="cloud"]').isDisabled()){
      result.scenes.cloud={disabled:true,time:cloudTime};
      continue;
    }
    await page.locator('.tabs button[data-scene="'+scene+'"]').click();
    await page.waitForTimeout(scene==='wind'?1800:900);
    const field=await stats('#fieldCanvas');
    const motion=await stats('#motionCanvas');
    result.scenes[scene]={
      field,
      motion,
      windMotion:scene==='wind'?await windMotionStats():null,
      time:await page.locator('#timeLabel').innerText(),
      meta:await page.locator('#timeMeta').innerText(),
      model:await page.locator('#modelBadge').innerText()
    };
  }

  const box=await page.locator('#map').boundingBox();
  if(box){
    await page.mouse.click(box.x+box.width*.52,box.y+box.height*.52);
    await page.waitForTimeout(500);
    result.flag=await page.locator('.selection-flag').isVisible().catch(()=>false);
  }

  const cloud=result.scenes.cloud?.field?.visible||0;
  const cloudDisabled=result.scenes.cloud?.disabled===true;
  const cloudStale=Number.isFinite(result.runtime?.cloudAgeMin)&&result.runtime.cloudAgeMin>35;
  const cloudOk=(cloudDisabled&&cloudStale)||(!cloudDisabled&&cloud>20);
  const rain=result.scenes.rain?.field?.visible||0;
  const windField=result.scenes.wind?.field?.visible||0;
  const windMotion=result.scenes.wind?.windMotion?.maxVisible||0;
  const wave=result.scenes.wave?.field?.visible||0;
  result.ok=
    cloudOk &&
    rain>20 &&
    windField<=4 &&
    windMotion>8 &&
    wave>20 &&
    result.flag &&
    result.pageErrors.length===0 &&
    result.consoleErrors.length===0;
}catch(e){result.failure=String(e?.stack||e)}

await writeFile('/tmp/weather-scene-v3-smoke.json',JSON.stringify(result,null,2)+'\n','utf8');
console.log(JSON.stringify(result,null,2));
await browser.close();
if(!result.ok)process.exitCode=1;
