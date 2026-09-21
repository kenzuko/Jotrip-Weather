import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';

const base='https://weather.openphuquoc.com';
const result={ok:false,embed:null,scenes:{},flag:null,comparisons:{},forecast:null,desktop:null,pageErrors:[],consoleErrors:[],failure:null};
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
  await page.locator('.map-panel').scrollIntoViewIfNeeded();
  await page.locator('[data-map="jotrip"]').click();

  const iframe=page.locator('iframe[data-jotrip-scene]');
  await iframe.waitFor({state:'visible',timeout:120000});
  const frame=page.frames().find(f=>f.url().includes('/weather-scene-v3.html'));
  if(!frame)throw new Error('Scene V3 iframe missing');
  await frame.waitForFunction(()=>document.getElementById('loading')?.classList.contains('hidden'),null,{timeout:120000});

  result.embed=await frame.evaluate(()=>({
    embedMode:document.body.classList.contains('embed-mode'),
    topbarDisplay:getComputedStyle(document.querySelector('.topbar')).display,
    renderer:window.JoTripSceneRenderer?.version||null
  }));

  for(const scene of ['cloud','rain','wind','wave']){
    await frame.locator('.tabs button[data-scene="'+scene+'"]').click();
    await page.waitForTimeout(scene==='wind'?1300:800);
    result.scenes[scene]={
      field:await stats(frame,'#fieldCanvas'),
      motion:scene==='wind'?await maxMotion(frame):await stats(frame,'#motionCanvas'),
      time:(await frame.locator('#timeLabel').innerText()).trim()
    };
  }

  await frame.locator('.tabs button[data-scene="wave"]').click();
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

  await page.locator('#forecastRegionTabs button[data-region]').first().waitFor({state:'visible',timeout:30000});
  result.forecast={
    regions:await page.locator('#forecastRegionTabs button[data-region]').allTextContents(),
    pointTabs:await page.locator('#pointTabs button').allTextContents(),
    state:(await page.locator('#ensembleState').innerText()).trim()
  };

  const desktop=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
  await desktop.goto(base+'/?desktopqa='+Date.now(),{waitUntil:'domcontentloaded',timeout:120000});
  await desktop.locator('.map-panel').scrollIntoViewIfNeeded();
  await desktop.locator('[data-map="jotrip"]').click();
  const desktopIframe=desktop.locator('iframe[data-jotrip-scene]');
  await desktopIframe.waitFor({state:'visible',timeout:120000});
  const desktopFrame=desktop.frames().find(f=>f.url().includes('/weather-scene-v3.html'));
  if(!desktopFrame)throw new Error('Desktop Scene V3 iframe missing');
  await desktopFrame.waitForFunction(()=>document.getElementById('loading')?.classList.contains('hidden'),null,{timeout:120000});
  await desktop.waitForTimeout(500);
  result.desktop=await desktopFrame.evaluate(()=>({
    lonSpan:Number(document.documentElement.dataset.sceneLonSpan||NaN),
    latSpan:Number(document.documentElement.dataset.sceneLatSpan||NaN),
    freshness:(document.getElementById('freshness')?.textContent||'').trim()
  }));
  await desktop.locator('#mapBox').screenshot({path:'/tmp/prod-jotrip-scene-desktop.png'});
  await desktop.close();

  const sceneOk=
    result.scenes.cloud.field.visible>20 &&
    result.scenes.rain.field.visible>20 &&
    result.scenes.wind.motion.visible>4 &&
    result.scenes.wave.field.visible>20;

  result.ok=
    result.embed?.embedMode===true &&
    result.embed?.topbarDisplay==='none' &&
    String(result.embed?.renderer||'').includes('wave-direction-convention') &&
    sceneOk &&
    result.flag?.visible===true &&
    result.flag?.changed===true &&
    result.flag?.waveDirection===true &&
    result.comparisons.himawari===true &&
    result.comparisons.windyWind===true &&
    result.forecast?.regions?.includes('Gành Dầu - Cửa Cạn') &&
    result.forecast?.regions?.includes('Dương Đông') &&
    !result.forecast?.regions?.some(x=>/Bắc|Đông Bắc|Tây Bắc/.test(x)) &&
    !result.forecast?.pointTabs?.some(x=>x.includes('Rạch Giá')) &&
    Number.isFinite(result.desktop?.lonSpan) &&
    result.desktop.lonSpan<2 &&
    result.desktop.latSpan<1 &&
    result.pageErrors.length===0;
}catch(e){result.failure=String(e?.stack||e)}

await writeFile('/tmp/spatial-production-result.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
await browser.close();
if(!result.ok)process.exitCode=1;
