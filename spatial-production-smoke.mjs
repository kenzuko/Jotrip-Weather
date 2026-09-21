import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';

const BUILD='V6.13-PROD';
const base='https://weather.openphuquoc.com';
const result={ok:false,build:null,layers:{},himawari:{},pageErrors:[],consoleErrors:[],failure:null};
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2});
page.on('pageerror',e=>result.pageErrors.push(String(e)));
page.on('console',m=>{if(m.type()==='error')result.consoleErrors.push(m.text())});

async function stats(frame,sel){
  return frame.locator(sel).evaluate(canvas=>{
    if(!(canvas instanceof HTMLCanvasElement)||!canvas.width||!canvas.height)return {visible:0,strong:0,meanAlpha:0};
    const d=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    let n=0,visible=0,strong=0,sum=0;
    for(let i=3;i<d.length;i+=64){const a=d[i];n++;sum+=a;if(a>8)visible++;if(a>40)strong++}
    return {visible,strong,meanAlpha:n?sum/n:0};
  });
}

try{
  await page.goto(base+'/?qa='+Date.now(),{waitUntil:'domcontentloaded',timeout:120000});
  await page.locator('.map-panel').scrollIntoViewIfNeeded();
  await page.locator('[data-map="jotrip"]').click();
  const iframe=page.locator('iframe[data-jotrip-spatial]');
  await iframe.waitFor({state:'visible',timeout:120000});
  const frame=page.frames().find(f=>f.url().includes('/spatial-lab.html'));
  if(!frame)throw new Error('Spatial iframe missing');
  await frame.waitForFunction(()=>document.getElementById('dataStatus')?.textContent?.includes('ĐANG HOẠT ĐỘNG'),null,{timeout:120000});
  result.build=await frame.evaluate(()=>document.documentElement.dataset.spatialBuild||null);
  if(result.build!==BUILD)throw new Error('Production build mismatch: '+result.build+' != '+BUILD);

  for(const layer of ['wind','rain','waves','current','storm']){
    await frame.locator('.layer[data-layer="'+layer+'"]').click();
    await page.waitForTimeout(layer==='storm'?2200:1700);
    result.layers[layer]={
      field:await stats(frame,'#fieldCanvas'),
      flow:await stats(frame,'#flowCanvas'),
      readout:(await frame.locator('#readoutValue').innerText())+' '+(await frame.locator('#readoutUnit').innerText())
    };
    await page.screenshot({path:'/tmp/prod-'+layer+'.png',fullPage:false});
  }

  await page.locator('[data-map="himawari"]').click();
  await page.locator('.himawari-georef .leaflet-image-layer').waitFor({state:'visible',timeout:120000});
  result.himawari.image=await page.locator('.himawari-georef .leaflet-image-layer').getAttribute('src');
  result.himawari.badge=await page.locator('.himawari-ir-badge').innerText();
  result.himawari.mapVisible=await page.locator('#himawariMap').isVisible();
  await page.screenshot({path:'/tmp/prod-himawari.png',fullPage:false});

  result.ok=true;
}catch(e){result.failure=String(e?.stack||e)}
await writeFile('/tmp/spatial-production-result.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
await browser.close();
if(!result.ok)process.exitCode=1;
