import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';

const layers = ['wind','rain','rain24','waves','current','storm'];
const result = { ok:false, layers:{}, pageErrors:[], consoleErrors:[], failure:null };
const browser = await chromium.launch({headless:true});
const page = await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2});
page.on('pageerror', e=>result.pageErrors.push(String(e)));
page.on('console', m=>{ if(m.type()==='error') result.consoleErrors.push(m.text()); });

async function stats(sel){
  return page.locator(sel).evaluate((canvas)=>{
    if(!(canvas instanceof HTMLCanvasElement) || !canvas.width || !canvas.height) return {w:0,h:0,samples:0,visible:0,strong:0,meanAlpha:0};
    const d=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    let samples=0,visible=0,strong=0,sum=0;
    for(let i=3;i<d.length;i+=64){
      const a=d[i]; samples++; sum+=a;
      if(a>8)visible++;
      if(a>40)strong++;
    }
    return {w:canvas.width,h:canvas.height,samples,visible,strong,meanAlpha:samples?sum/samples:0};
  });
}

try{
  await page.goto('http://127.0.0.1:4173/spatial-lab.html?embed=1',{waitUntil:'domcontentloaded',timeout:120000});
  await page.waitForFunction(()=>document.getElementById('dataStatus')?.textContent?.includes('ĐANG HOẠT ĐỘNG'),{timeout:120000});
  await page.waitForTimeout(1500);

  for(const layer of layers){
    await page.locator('.layer[data-layer="'+layer+'"]').click();
    await page.waitForTimeout(layer==='storm'?2200:1500);
    result.layers[layer]={
      field:await stats('#fieldCanvas'),
      flow:await stats('#flowCanvas'),
      readout:(await page.locator('#readoutValue').innerText())+' '+(await page.locator('#readoutUnit').innerText()),
      time:await page.locator('#timeLabel').innerText()
    };
    await page.screenshot({path:'/tmp/spatial-'+layer+'.png'});
  }
  result.ok=true;
}catch(e){ result.failure=String(e?.stack||e); }

await writeFile('/tmp/spatial-lab-smoke-result.json',JSON.stringify(result,null,2)+'\n','utf8');
console.log(JSON.stringify(result,null,2));
await browser.close();
if(!result.ok) process.exitCode=1;
