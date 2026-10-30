import { createLogoLoader } from './logo-loader.js';
export function createTokenArtwork(){
  const loader=createLogoLoader();
  return function render(host,token){
    host.replaceChildren();const fallback=document.createElement('span');fallback.className='artwork-fallback';fallback.setAttribute('aria-hidden','true');fallback.textContent=String(token.symbol||token.name||'?').slice(0,2);host.append(fallback);
    let cancel=()=>{},stopped=false,img=null;const failed=[];
    function load(){cancel=loader.load({...token,excludeLogos:failed},result=>{
      if(stopped)return;img?.remove();img=document.createElement('img');img.alt='';img.width=44;img.height=44;img.referrerPolicy='no-referrer';img.decoding='async';
      img.onload=()=>{if(!stopped)fallback.hidden=true;};img.onerror=()=>{if(stopped)return;fallback.hidden=false;img.remove();failed.push(result.src);if(failed.length<3)load();};img.src=result.src;host.append(img);
    });}
    load();return()=>{stopped=true;cancel();if(img){img.onload=img.onerror=null;}};
  };
}
