// rerun after mapPane sizing fix
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';

const target='https://weather.openphuquoc.com/weather-scene-v3.html?visualqa='+Date.now();
const result={target,ok:false,scenes:{},pageErrors:[],consoleErrors:[],failure:null};

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

try{
  await page.goto(target,{waitUntil:'domcontentloaded',timeout:120000});
  await page.waitForFunction(()=>document.getElementById('loading')?.classList.contains('hidden'),{timeout:120000});
  await page.waitForTimeout(1500);

  for(const scene of ['cloud','rain','wind','wave']){
    await page.locator('.tabs button[data-scene="'+scene+'"]').click();
    await page.waitForTimeout(scene==='wind'?1800:900);

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
      visiblePngBytes:before.length,
      hiddenPngBytes:hidden.length
    };
  }

  // Use browser screenshot entropy proxy: if hiding canvases barely changes PNG size for all scenes,
  // the rendered weather is likely visually ineffective.
  result.ok=Object.values(result.scenes).some(s=>Math.abs(s.visiblePngBytes-s.hiddenPngBytes)>1500) &&
    result.pageErrors.length===0;
}catch(e){result.failure=String(e?.stack||e)}

await writeFile('/tmp/weather-scene-v3-visual.json',JSON.stringify(result,null,2)+'\n','utf8');
console.log(JSON.stringify(result,null,2));
await browser.close();
if(!result.ok)process.exitCode=1;
