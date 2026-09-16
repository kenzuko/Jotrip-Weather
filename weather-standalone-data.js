(()=>{
  const ENGINE='https://raw.githubusercontent.com/kenzuko/Jotrip-Lab/feat/weather-lab-data-engine-v1';
  const rawFetch=window.fetch.bind(window);
  window.fetch=(input,init)=>{
    const original=typeof input==='string'?input:(input&&input.url)||'';
    if(original.startsWith('/weather/') && /\.json(?:[?#]|$)/i.test(original)){
      const clean=original.split('#')[0];
      const target=`${ENGINE}${clean}${clean.includes('?')?'&':'?'}t=${Date.now()}`;
      return rawFetch(target,{...init,cache:'no-store'});
    }
    return rawFetch(input,init);
  };
})();
