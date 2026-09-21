import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';

const target='https://weather.openphuquoc.com/weather-scene-v3.html?prodqa='+Date.now();
const result={target,ok:false,scenes:{},flag:false,manifest:null,pageErrors:[],consoleErrors:[],failure:null};

const browser=await chromium.launch({headless:true});
const page=await browser.newPage({
  viewport:{width:390,height:844},
  deviceScaleFactor:2,
  userAgent:'JoTripWeatherProdSmoke/1.0'
});
page.on('pageerror',e=>result.pageErrors.push(String(e)));
page.on('console',m=>{if(m.type()==='error')result.consoleErrors.push(m.text());});

async function canvasStats(sel){
  return page.locator(sel).evaluate(canvas=>{
    if(!(canvas instanceof HTMLCanvasElement)||!canvas.width||!canvas.height){
      return {w:0,h:0,samples:0,visible:0,strong:0,meanAlpha:0};
    }
    const ctx=canvas.getContext('2d');
    const d=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    let samples=0,visible=0,strong=0,sum=0;
    const stride=64;
    for(let i=3;i<d.length;i+=stride){
      const a=d[i];samples++;sum+=a;
      if(a>8)visible++;
      if(a>40)strong++;
    }
    return {w:canvas.width,h:canvas.height,samples,visible,strong,meanAlpha:samples?sum/samples:0};
  });
}

try{
  await page.goto(target,{waitUntil:'domcontentloaded',timeout:120000});
  await page.waitForFunction(()=>document.getElementById('loading')?.classList.contains('hidden'),{timeout:120000});
  await page.waitForTimeout(1800);

  result.manifest=await page.evaluate(async()=>{
    const r=await fetch('/data/weather-runtime/manifest.json?qa='+Date.now(),{cache:'no-store'});
    if(!r.ok) throw new Error('manifest HTTP '+r.status);
    return r.json();
  });

  for(const scene of ['cloud','rain','wind','wave']){
    const btn=page.locator('.tabs button[data-scene="'+scene+'"]');
    await btn.click();
    await page.waitForTimeout(scene==='wind'?2200:1200);
    result.scenes[scene]={
      disabled:await btn.isDisabled(),
      field:await canvasStats('#fieldCanvas'),
      motion:await canvasStats('#motionCanvas'),
      time:(await page.locator('#timeLabel').innerText()).trim(),
      meta:(await page.locator('#timeMeta').innerText()).trim(),
      model:(await page.locator('#modelBadge').innerText()).trim(),
      headline:(await page.locator('#headline').innerText()).trim()
    };
  }

  await page.locator('.tabs button[data-scene="cloud"]').click();
  await page.waitForTimeout(700);
  const box=await page.locator('#map').boundingBox();
  if(box){
    await page.mouse.click(box.x+box.width*.52,box.y+box.height*.56);
    await page.waitForTimeout(600);
    result.flag=await page.locator('.selection-flag').isVisible().catch(()=>false);
  }

  const c=result.scenes.cloud?.field?.visible||0;
  const r=result.scenes.rain?.field?.visible||0;
  const w=(result.scenes.wind?.field?.visible||0)+(result.scenes.wind?.motion?.visible||0);
  const v=result.scenes.wave?.field?.visible||0;
  const sourcePolicy=result.manifest?.policy?.frontend_source==='SAME_ORIGIN_CANONICAL_ONLY';
  const noFallback=result.manifest?.policy?.browser_fallback==='DISABLED'&&result.manifest?.policy?.legacy_fallback==='DISABLED';
  const modelBadges=[
    result.scenes.rain?.model||'',
    result.scenes.wind?.model||'',
    result.scenes.wave?.model||''
  ].every(x=>x.includes('RUN'));
  const observedBadge=(result.scenes.cloud?.model||'').includes('HIMAWARI-9');
  const tabsOk=Object.values(result.scenes).every(x=>x.disabled===false);
  result.ok=
    c>20 &&
    r>20 &&
    w>20 &&
    v>20 &&
    result.flag &&
    sourcePolicy &&
    noFallback &&
    modelBadges &&
    observedBadge &&
    tabsOk &&
    result.pageErrors.length===0;

}catch(e){
  result.failure=String(e?.stack||e);
}

await writeFile('/tmp/weather-scene-v3-prod-smoke.json',JSON.stringify(result,null,2)+'\n','utf8');
console.log(JSON.stringify(result,null,2));
await browser.close();
if(!result.ok) process.exitCode=1;
