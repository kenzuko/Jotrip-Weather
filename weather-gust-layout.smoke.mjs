// Reproduces the Mac screenshot regression: a narrow desktop rail used to
// squeeze "Gió giật tại điểm" into a near-zero-width column. Run on every PR.
// Local static page, deterministic labels; no weather API or live observations.
import assert from "node:assert/strict";
import {writeFile} from "node:fs/promises";
import {chromium,webkit} from "playwright";

const pagePath=process.argv[2]||"/";
const widths=[1440,1024,768,390,320];
const results=[];
for(const [browserName,browserType] of [["chromium",chromium],["webkit",webkit]]){
  const browser=await browserType.launch({headless:true});
  try{
    for(const width of widths){
      const context=await browser.newContext({viewport:{width,height:900},deviceScaleFactor:1});
      const page=await context.newPage();
      // This is intentionally a CSS/DOM regression test. Runtime JSON and
      // forecasting have separate CI tests; JS never changes fixture values.
      await page.route(/\/weather-v2\.js(?:\?|$)/,route=>
        route.fulfill({status:200,contentType:"application/javascript",body:""}));
      await page.goto("http://127.0.0.1:8765"+pagePath,{waitUntil:"domcontentloaded",timeout:20000});
      await page.locator("#heroGust").waitFor();
      await page.evaluate(async()=>{
        await document.fonts.ready;
        document.querySelector("#heroWind").textContent="28";
        document.querySelector("#heroGust").textContent="42";
        document.querySelector("#heroGustMeta").textContent=
          "km/h · DỰ BÁO mốc 13:00 · không phải số đo lúc này";
        document.querySelector("#heroRain").textContent="6.4";
        document.querySelector("#heroWave").textContent="1.0";
      });
      const metrics=await page.evaluate(()=>{
        const rect=el=>{const r=el.getBoundingClientRect();return {
          x:r.x,y:r.y,width:r.width,height:r.height,
          left:r.left,right:r.right,top:r.top,bottom:r.bottom
        }};
        const cards=[...document.querySelectorAll(".weather-now-facts>div")];
        const gust=document.querySelector(".weather-gust-fact");
        const label=gust?.querySelector("span"),value=gust?.querySelector("b"),meta=gust?.querySelector("small");
        const facts=document.querySelector(".weather-now-facts");
        if(!gust||cards.length!==4)throw Error("Weather hero must have exactly four fact cards");
        return {cards:cards.map(rect),gust:rect(gust),label:rect(label),
          value:rect(value),meta:rect(meta),
          labelWordBreak:getComputedStyle(label).wordBreak,
          metaGridColumn:getComputedStyle(meta).gridColumn,
          cardDisplay:getComputedStyle(gust).display,
          factsDisplay:getComputedStyle(facts).display,
          factsWidth:facts.clientWidth,factsScrollWidth:facts.scrollWidth,
          docWidth:document.documentElement.scrollWidth,
          viewport:window.innerWidth};
      });
      const key=browserName+"-"+width;
      const checks=[];
      const check=(expr,description)=>{
        checks.push({description,passed:Boolean(expr)});
        assert.ok(expr,key+": "+description+" "+JSON.stringify(metrics));
      };
      check(metrics.label.width>=82,"gust label keeps at least 82px (not letter-stacked)");
      check(metrics.label.height<65,"gust label uses at most a few normal lines");
      check(metrics.labelWordBreak==="normal","gust label keeps whole Vietnamese words");
      check(metrics.gust.right<=metrics.viewport+2,"gust card stays within viewport");
      check(metrics.factsScrollWidth<=metrics.factsWidth+2,"four fact cards do not overflow rail");
      check(metrics.meta.right<=metrics.gust.right+2,"source/time metadata stays inside gust card");
      check(metrics.value.right<=metrics.gust.right+2,"gust value stays inside gust card");
      check(metrics.meta.top>=metrics.value.bottom-2,"source and valid time get a separate line");
      check(metrics.cards.every(r=>r.width>85),"four fact cards retain usable width");
      if(width>=981){
        check(metrics.label.right<=metrics.value.left+3,
          "desktop label and number do not overlap");
      }else{
        check(metrics.label.bottom<=metrics.value.top+3,
          "tablet and mobile stack label above number");
      }
      await page.screenshot({path:"/tmp/weather-visual-"+key+".png",fullPage:false});
      results.push({browser:browserName,width,checks,metrics});
      console.log("PASS",key,checks.length+" geometry and typography checks");
      await context.close();
    }
  }finally{await browser.close()}
}
await writeFile("/tmp/weather-layout-report.json",JSON.stringify({results},null,2));
console.log("PASS all "+results.length+" Chromium/WebKit viewport scenarios");
