import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';

const base='https://weather.openphuquoc.com';
const result={ok:false,overview:null,embed:null,runtime:null,scenes:{},flag:null,comparisons:{},forecast:null,desktop:null,pageErrors:[],consoleErrors:[],failure:null};
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2});
page.on('pageerror',e=>result.pageErrors.push(String(e)));
page.on('console',m=>{if(m.type()==='error')result.consoleErrors.push(m.text())});

async function stats(frame,sel){
  return frame.locator(sel).evaluate(canvas=>{
    if(!(canvas instanceof HTMLCanvasElement)||!canvas.width||!canvas.height)return {visible:0,strong:0,meanAlpha:0};
    const d=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    let n=0,visible=0,strong=0,sum=0;
    for(let i=3;i<d.length;i+=32){const a=d[i];n++;sum+=a;if(a>8)visible++;if(a>40)strong++}
    return {visible,strong,meanAlpha:n?sum/n:0};
  });
}
async function maxMotion(frame){
  const samples=[];
  for(let i=0;i<5;i++){
    samples.push(await stats(frame,'#motionCanvas'));
    await new Promise(r=>setTimeout(r,180));
  }
  return samples.reduce((best,x)=>x.visible>best.visible?x:best,{visible:0,strong:0,meanAlpha:0});
}

try{
  await page.goto(base+'/?mergeqa='+Date.now(),{waitUntil:'domcontentloaded',timeout:120000});
  const overview=page.locator('.weather-overview');
  await overview.waitFor({state:'visible',timeout:30000});
  await page.waitForFunction(()=>document.getElementById('heroTemp')?.textContent.trim()!=='--',null,{timeout:45000});
  result.overview=await overview.evaluate(el=>({
    width:el.getBoundingClientRect().width,
    scrollWidth:el.scrollWidth,
    condition:(document.getElementById('heroCondition')?.textContent||'').trim(),
    temp:(document.getElementById('heroTemp')?.textContent||'').trim(),
    rain:(document.getElementById('heroRain')?.textContent||'').trim(),
    wind:(document.getElementById('heroWind')?.textContent||'').trim(),
    wave:(document.getElementById('heroWave')?.textContent||'').trim()
  }));
  await overview.screenshot({path:'/tmp/prod-weather-overview-mobile.png'});
  await page.locator('.map-panel').scrollIntoViewIfNeeded();
  await page.locator('[data-map="jotrip"]').click();

  const iframe=page.locator('iframe[data-jotrip-scene]');
  await iframe.waitFor({state:'visible',timeout:120000});
  const frame=iframe.contentFrame();
  await frame.locator('#loading.hidden').waitFor({state:'attached',timeout:120000});

  result.embed=await frame.locator('html').evaluate(()=>({
    embedMode:document.body.classList.contains('embed-mode'),
    topbarDisplay:getComputedStyle(document.querySelector('.topbar')).display,
    renderer:window.JoTripSceneRenderer?.version||null
  }));
  result.runtime=await frame.locator('html').evaluate(async()=>{
    const r=await fetch('/data/weather-runtime/manifest.json?t='+Date.now(),{cache:'no-store'});
    const m=await r.json();
    const t=Date.parse(m?.source_times?.cloud_sampled_time||'');
    return {
      cloudSampled:m?.source_times?.cloud_sampled_time||null,
      cloudAgeMin:Number.isFinite(t)?Math.max(0,(Date.now()-t)/60000):null
    };
  });

  for(const scene of ['cloud','rain','wind','wave']){
    const btn=frame.locator('.tabs button[data-scene="'+scene+'"]');
    const enabled=await btn.isEnabled();
    if(!enabled){
      result.scenes[scene]={disabled:true};
      continue;
    }
    await btn.click();
    await page.waitForTimeout(scene==='wind'?1300:800);
    result.scenes[scene]={
      disabled:false,
      field:await stats(frame,'#fieldCanvas'),
      motion:scene==='wind'?await maxMotion(frame):await stats(frame,'#motionCanvas'),
      time:(await frame.locator('#timeLabel').innerText()).trim()
    };
  }

  const waveBtn=frame.locator('.tabs button[data-scene="wave"]');
  if(!(await waveBtn.isEnabled()))throw new Error('Wave scene unexpectedly unavailable');
  await waveBtn.click();
  const mapBox=await frame.locator('#map').boundingBox();
  if(!mapBox)throw new Error('Scene map box missing');
  await frame.locator('#map').click({position:{x:mapBox.width*.48,y:mapBox.height*.50}});
  await page.waitForTimeout(350);
  const before=(await frame.locator('.leaflet-popup.selection-popup').innerText()).trim();
  const slider=frame.locator('#slider');
  const max=Number(await slider.getAttribute('max')||0);
  await slider.evaluate((el,v)=>{el.value=String(v);el.dispatchEvent(new Event('input',{bubbles:true}))},Math.min(max,Math.max(1,Math.floor(max*.65))));
  await page.waitForTimeout(450);
  const after=(await frame.locator('.leaflet-popup.selection-popup').innerText()).trim();
  result.flag={
    visible:await frame.locator('.selection-flag').isVisible().catch(()=>false),
    changed:before!==after,
    waveDirection:/Sóng đến từ \d+° · đi về \d+°/.test(after)
  };
  await page.screenshot({path:'/tmp/prod-jotrip-scene.png',fullPage:false});

  await page.locator('[data-map="himawari"]').click();
  await page.locator('.himawari-georef .leaflet-image-layer').waitFor({state:'visible',timeout:120000});
  result.comparisons.himawari=true;

  await page.locator('[data-map="wind"]').click();
  const windy=page.locator('#mapBox iframe');
  await windy.waitFor({state:'attached',timeout:30000});
  const windySrc=await windy.getAttribute('src');
  result.comparisons.windyWind=Boolean(windySrc&&windySrc.includes('embed.windy.com')&&windySrc.includes('overlay=wind'));

  await page.locator('.jotrip-forecast-panel .forecast-day').first().waitFor({state:'visible',timeout:30000});
  await page.locator('.jotrip-forecast-panel').scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await page.locator('.jotrip-forecast-panel').screenshot({path:'/tmp/prod-weather-forecast-mobile.png'});
  result.forecast={
    regions:await page.locator('#forecastRegionTabs button[data-region]').allTextContents(),
    regionSelectorHidden:await page.locator('#forecastRegionTabs').isHidden().catch(()=>false),
    pointTabs:await page.locator('#pointTabs button').allTextContents(),
    state:(await page.locator('#ensembleState').innerText()).trim(),
    detailOpen:await page.locator('.forecast-detail-toggle').evaluate(el=>el.open),
    dayCards:await page.locator('.forecast-day').count()
  };

  const desktop=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
  await desktop.goto(base+'/?desktopqa='+Date.now(),{waitUntil:'domcontentloaded',timeout:120000});
  const desktopOverview=desktop.locator('.weather-overview');
  await desktopOverview.waitFor({state:'visible',timeout:30000});
  await desktopOverview.screenshot({path:'/tmp/prod-weather-overview-desktop.png'});
  await desktop.locator('.jotrip-forecast-panel .forecast-day').first().waitFor({state:'visible',timeout:60000});
  await desktop.locator('.jotrip-forecast-panel').scrollIntoViewIfNeeded();
  await desktop.waitForTimeout(250);
  await desktop.locator('.jotrip-forecast-panel').screenshot({path:'/tmp/prod-weather-forecast-desktop.png'});
  await desktop.locator('.map-panel').scrollIntoViewIfNeeded();
  await desktop.locator('[data-map="jotrip"]').click();
  const desktopIframe=desktop.locator('iframe[data-jotrip-scene]');
  await desktopIframe.waitFor({state:'visible',timeout:120000});
  const desktopFrame=desktopIframe.contentFrame();
  await desktopFrame.locator('#loading.hidden').waitFor({state:'attached',timeout:120000});
  await desktop.waitForTimeout(500);
  result.desktop=await desktopFrame.locator('html').evaluate(()=>({
    lonSpan:Number(document.documentElement.dataset.sceneLonSpan||NaN),
    latSpan:Number(document.documentElement.dataset.sceneLatSpan||NaN),
    freshness:(document.getElementById('freshness')?.textContent||'').trim()
  }));
  await desktop.locator('#mapBox').screenshot({path:'/tmp/prod-jotrip-scene-desktop.png'});
  await desktop.close();

  const cloudDisabled=result.scenes.cloud?.disabled===true;
  const cloudStale=Number.isFinite(result.runtime?.cloudAgeMin)&&result.runtime.cloudAgeMin>35;
  const cloudOk=(cloudDisabled&&cloudStale)||(!cloudDisabled&&(result.scenes.cloud?.field?.visible||0)>20);
  const sceneOk=
    cloudOk &&
    result.scenes.rain.field.visible>20 &&
    result.scenes.wind.motion.visible>4 &&
    result.scenes.wave.field.visible>20;

  result.ok=
    result.overview?.width>0 &&
    result.overview?.scrollWidth<=result.overview?.width+2 &&
    result.overview?.condition.length>0 &&
    result.overview?.temp!=='--' &&
    result.embed?.embedMode===true &&
    result.embed?.topbarDisplay==='none' &&
    String(result.embed?.renderer||'').includes('wave-island-anchors') &&
    sceneOk &&
    result.flag?.visible===true &&
    result.flag?.changed===true &&
    result.flag?.waveDirection===true &&
    result.comparisons.himawari===true &&
    result.comparisons.windyWind===true &&
    result.forecast?.regions?.includes('Gành Dầu - Cửa Cạn') &&
    result.forecast?.regions?.includes('Dương Đông') &&
    result.forecast?.regionSelectorHidden===true &&
    !result.forecast?.regions?.some(x=>/Bắc|Đông Bắc|Tây Bắc/.test(x)) &&
    result.forecast?.detailOpen===false &&
    result.forecast?.dayCards>=4 &&
    Number.isFinite(result.desktop?.lonSpan) &&
    result.desktop.lonSpan<2 &&
    result.desktop.latSpan<1 &&
    result.pageErrors.length===0 &&
    result.consoleErrors.length===0;
}catch(e){result.failure=String(e?.stack||e)}

await writeFile('/tmp/spatial-production-result.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
await browser.close();
if(!result.ok)process.exitCode=1;
