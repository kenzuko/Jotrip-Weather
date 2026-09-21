import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';

const target='https://weather.openphuquoc.com/weather-scene-v3.html?flagqa='+Date.now();
const result={target,ok:false,scenes:{},play:null,pageErrors:[],consoleErrors:[],failure:null};

const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2});
page.on('pageerror',e=>result.pageErrors.push(String(e)));
page.on('console',m=>{if(m.type()==='error')result.consoleErrors.push(m.text());});

async function setSlider(value){
  await page.locator('#slider').evaluate((el,v)=>{
    el.value=String(v);
    el.dispatchEvent(new Event('input',{bubbles:true}));
  },value);
  await page.waitForTimeout(500);
}
async function popupText(){
  return (await page.locator('.leaflet-popup.selection-popup .leaflet-popup-content').innerText()).trim();
}
async function chooseScene(scene){
  await page.locator('.tabs button[data-scene="'+scene+'"]').click();
  await page.waitForTimeout(scene==='wind'?1300:700);
}
async function placeFlagOnce(){
  const box=await page.locator('#map').boundingBox();
  if(!box) throw new Error('map box missing');
  await page.mouse.click(box.x+box.width*.52,box.y+box.height*.57);
  await page.waitForTimeout(500);
  if(!(await page.locator('.selection-flag').isVisible().catch(()=>false))){
    throw new Error('selection flag not visible');
  }
}

try{
  await page.goto(target,{waitUntil:'domcontentloaded',timeout:120000});
  await page.waitForFunction(()=>document.getElementById('loading')?.classList.contains('hidden'),{timeout:120000});
  await page.waitForTimeout(1500);

  await chooseScene('rain');
  await placeFlagOnce();

  for(const scene of ['rain','wind','wave']){
    await chooseScene(scene);
    const max=Number(await page.locator('#slider').getAttribute('max')||0);
    await setSlider(0);
    const first=await popupText();
    const firstTime=(await page.locator('#timeLabel').innerText()).trim();
    await setSlider(max);
    const last=await popupText();
    const lastTime=(await page.locator('#timeLabel').innerText()).trim();
    result.scenes[scene]={
      max,
      firstTime,lastTime,
      first,last,
      changed:first!==last,
      frameChanged:firstTime!==lastTime,
      forecastPresent:first.includes('JoTrip Forecast')&&last.includes('JoTrip Forecast')
    };
  }

  await chooseScene('rain');
  await setSlider(0);
  const before=await popupText();
  const beforeTime=(await page.locator('#timeLabel').innerText()).trim();
  await page.locator('#playBtn').click();
  await page.waitForTimeout(1450);
  await page.locator('#playBtn').click();
  await page.waitForTimeout(300);
  const after=await popupText();
  const afterTime=(await page.locator('#timeLabel').innerText()).trim();
  result.play={beforeTime,afterTime,before,after,changed:before!==after,frameChanged:beforeTime!==afterTime};

  result.ok=
    Object.values(result.scenes).every(x=>x.max>0&&x.changed&&x.frameChanged&&x.forecastPresent) &&
    result.play.changed &&
    result.play.frameChanged &&
    result.pageErrors.length===0;
}catch(e){
  result.failure=String(e?.stack||e);
}

await writeFile('/tmp/weather-scene-v3-flag-timeline.json',JSON.stringify(result,null,2)+'\n','utf8');
console.log(JSON.stringify(result,null,2));
await browser.close();
if(!result.ok)process.exitCode=1;
