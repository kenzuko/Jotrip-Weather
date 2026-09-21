import { readFile } from 'node:fs/promises';

const files=[
  'weather-runtime-config.js',
  'weather-scene-v3.html',
  'weather-scene-v3.js',
  'weather-scene-render-v2.js'
];

const banned=[
  'raw.githubusercontent.com',
  'github.io/Jotrip-Lab',
  'feat/weather-lab-data-engine-v1',
  '/data/weather-scene/',
  'data/nowcast.json',
  'data/dashboard-data.json'
];

let failed=false;
for(const file of files){
  const text=await readFile(file,'utf8');
  for(const token of banned){
    if(text.includes(token)){
      console.error('[SOURCE LOCK] forbidden legacy/direct source in '+file+': '+token);
      failed=true;
    }
  }
}

const config=await readFile('weather-runtime-config.js','utf8');
const required=[
  '/data/weather-runtime/manifest.json',
  '/data/weather-runtime/cloud.json',
  '/data/weather-runtime/compact.json',
  '/data/weather-runtime/current.json',
  '/data/weather-runtime/forecast.json',
  '/data/weather-runtime/marine.json',
  '/data/weather-runtime/meta.json'
];
for(const path of required){
  if(!config.includes(path)){
    console.error('[SOURCE LOCK] canonical runtime path missing: '+path);
    failed=true;
  }
}

const html=await readFile('weather-scene-v3.html','utf8');
const configPos=html.indexOf('/weather-runtime-config.js');
const appPos=html.indexOf('/weather-scene-v3.js');
if(configPos<0||appPos<0||configPos>appPos){
  console.error('[SOURCE LOCK] runtime registry must load before Weather Scene app');
  failed=true;
}

if(failed) process.exit(1);
console.log('Weather source lock PASS - canonical same-origin runtime only.');
