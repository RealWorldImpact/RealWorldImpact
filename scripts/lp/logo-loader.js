import { tokenLogoCandidates, sharperLogo } from './token-logos.js';

export function createLogoLoader({ImageClass=globalThis.Image,timeoutMs=2500,maxParallel=4}={}){
  const cache=new Map();
  return {
    load(token,onReady,onMissing=()=>{}){
      const excluded=new Set(token.excludeLogos||[]),originals=tokenLogoCandidates(token).filter(src=>!excluded.has(src));
      const key=String(token.address||'').toLowerCase()+':'+originals.join('|'),cached=cache.get(key);
      let stopped=false;
      if(cached){queueMicrotask(()=>{if(!stopped)onReady(cached);});return()=>{stopped=true;};}
      const sharp=[...new Set(originals.map(url=>sharperLogo(url)||url))].filter(src=>!excluded.has(src));
      let queue=sharp.slice(),fallback=originals.filter(url=>!sharp.includes(url)),active=0,best=null;
      const probes=new Set();
      const clean=()=>{for(const p of probes){clearTimeout(p.timer);p.image.onload=p.image.onerror=null;p.image.src='';}probes.clear();};
      const finish=result=>{
        if(stopped)return;stopped=true;clean();
        if(result){if(Math.min(result.width,result.height)>=128){if(cache.size>=100)cache.delete(cache.keys().next().value);cache.set(key,result);}onReady(result);}else onMissing();
      };
      const pump=()=>{
        if(stopped)return;
        while(active<maxParallel&&queue.length){
          const src=queue.shift(),image=new ImageClass(),probe={image,timer:null};active++;probes.add(probe);
          const settled=ok=>{
            if(stopped||!probes.has(probe))return;
            clearTimeout(probe.timer);probes.delete(probe);active--;image.onload=image.onerror=null;
            if(ok&&image.naturalWidth>0&&image.naturalHeight>0){const result={src,width:image.naturalWidth,height:image.naturalHeight};if(Math.min(result.width,result.height)>=128){finish(result);return;}if(!best||Math.min(result.width,result.height)>Math.min(best.width,best.height))best=result;}else image.src='';
            pump();
          };
          image.referrerPolicy='no-referrer';image.decoding='async';image.onload=()=>settled(true);image.onerror=()=>settled(false);
          probe.timer=setTimeout(()=>settled(false),timeoutMs);image.src=src;
        }
        if(!active&&!queue.length){
          if(best){finish(best);return;}
          if(fallback.length){queue=fallback;fallback=[];pump();}else finish(null);
        }
      };
      pump();return()=>{stopped=true;clean();};
    }
  };
}
