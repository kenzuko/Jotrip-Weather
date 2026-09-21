import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const target='https://weather.openphuquoc.com/weather-scene-v3.html?stackqa='+Date.now();
const out={target,variants:{},errors:[]};
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2});
page.on('pageerror',e=>out.errors.push(String(e)));

async function snap(name){
  const buf=await page.locator('.map-shell').screenshot({type:'png'});
  await writeFile('/tmp/'+name+'.png',buf);
  out.variants[name]={bytes:buf.length,sha:createHash('sha256').update(buf).digest('hex')};
}
try{
  await page.goto(target,{waitUntil:'domcontentloaded',timeout:120000});
  await page.waitForFunction(()=>document.getElementById('loading')?.classList.contains('hidden'),{timeout:120000});
  await page.locator('.tabs button[data-scene="cloud"]').click();
  await page.waitForTimeout(1200);
  await snap('baseline');

  await page.evaluate(()=>{
    for(const id of ['fieldCanvas','motionCanvas']){
      const c=document.getElementById(id);
      c.style.zIndex='99999';
      c.style.position='absolute';
    }
  });
  await page.waitForTimeout(300);
  await snap('z99999');

  await page.evaluate(()=>{
    const shell=document.querySelector('.map-shell');
    for(const id of ['fieldCanvas','motionCanvas']){
      const c=document.getElementById(id);
      shell.appendChild(c);
      Object.assign(c.style,{position:'absolute',inset:'0',zIndex:id==='fieldCanvas'?'500':'520',pointerEvents:'none'});
    }
  });
  await page.waitForTimeout(300);
  await snap('shell');

  await page.evaluate(()=>{
    const map=window.__debugMap||null;
    const labelPane=document.querySelector('.leaflet-pane.scene-label-pane');
    if(labelPane){
      for(const id of ['fieldCanvas','motionCanvas']){
        const c=document.getElementById(id);
        labelPane.parentElement.appendChild(c);
        Object.assign(c.style,{position:'absolute',left:'0',top:'0',zIndex:id==='fieldCanvas'?'350':'365',pointerEvents:'none'});
      }
    }
  });
  await page.waitForTimeout(300);
  await snap('mapPaneSibling');
}catch(e){out.errors.push(String(e?.stack||e))}
await writeFile('/tmp/weather-stack-debug.json',JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify(out,null,2));
await browser.close();
