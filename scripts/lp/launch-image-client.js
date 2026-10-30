import { sha256 } from 'ethers';
import { IMAGE_MAX_BYTES, checkStillImage, checkImageDimensions, imageUploadMessage, uploadedImageUrl } from './launch-image-policy.js';
import { logoUrls } from './token-logos.js';
import { createImageCropEditor } from './launch-image-editor.js';
const $=id=>document.getElementById(id);
function probe(src,signal){return new Promise((resolve,reject)=>{
  const image=new Image(),timer=setTimeout(()=>finish(Error('The image did not load. Choose another file or image URL.')),10000);
  const abort=()=>finish(Error('Image selection changed.'));
  const finish=(error)=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);image.onload=image.onerror=null;if(error){image.src='';reject(error);}else resolve({src,image,width:image.naturalWidth,height:image.naturalHeight});};
  image.referrerPolicy='no-referrer';image.decoding='async';image.onload=()=>{try{checkImageDimensions(image.naturalWidth,image.naturalHeight);finish();}catch(e){finish(e);}};image.onerror=()=>finish(Error('This image could not be loaded. Use a public image URL or upload a file.'));
  if(signal?.aborted)return abort();signal?.addEventListener('abort',abort,{once:true});image.src=src;
});}
export async function verifyLaunchImage(url,signal){
  if(!url)return '';const candidates=logoUrls(url);if(!candidates.length)throw Error('Use a public HTTPS or IPFS image URL.');
  try{return (await Promise.any(candidates.map(src=>probe(src,signal)))).src;}catch{throw Error('The token image could not be loaded. Select another image before launching.');}
}
export function createLaunchImageController({getSigner,getSession,onChange,onState}){
  let revision=0,aborter=null,objectUrl=null,cropUrl=null,source=null,selected=null,readyUrl='',uploaded=null,state='empty',urlTimer=null;
  const editor=createImageCropEditor({
    async onApply(blob,crop){
      const request=revision,original=source,bytes=new Uint8Array(await blob.arrayBuffer());
      if(request!==revision)return;
      if(bytes.length>IMAGE_MAX_BYTES)throw Error('The cropped image is too large. Choose a smaller image.');
      if(cropUrl)URL.revokeObjectURL(cropUrl);cropUrl=URL.createObjectURL(blob);
      selected={bytes,name:original.name,digest:sha256(bytes),crop};uploaded=null;readyUrl='';paint(cropUrl);onChange();
      setState('ready','Circular logo ready. Your wallet will sign a free message to upload it when you review.');$('launchImageEdit').focus();
    },
    onCancel(){if(selected){setState('ready','Your saved logo is unchanged.');$('launchImageEdit').focus();}else{clear();$('launchImageFile').focus();}},
    onError(error){setState('editing',error.message);}
  });
  function release(){aborter?.abort();aborter=new AbortController();editor.close();if(objectUrl)URL.revokeObjectURL(objectUrl);if(cropUrl)URL.revokeObjectURL(cropUrl);objectUrl=cropUrl=null;clearTimeout(urlTimer);}
  function setState(value,message){state=value;$('launchImageStatus').textContent=message;$('launchImageStatus').classList.toggle('error',value==='error');$('launchImageRemove').hidden=value==='empty';$('launchImageEdit').hidden=!selected||!source||value==='editing';$('launchImageEdit').disabled=value==='uploading';onState();}
  function paint(src){const img=$('launchImagePreview');img.hidden=!src;$('launchImageFallback').hidden=Boolean(src);if(src)img.src=src;else img.removeAttribute('src');}
  function begin(){revision++;release();source=null;selected=null;readyUrl='';uploaded=null;paint('');onChange();return revision;}
  function clear(){begin();$('launchImageFile').value='';$('launchLogo').value='';setState('empty','PNG, JPG, or WebP · Up to 3 MB · 128 × 128 minimum.');}
  async function chooseFile(file){
    const request=begin();$('launchLogo').value='';if(!file){setState('empty','PNG, JPG, or WebP · Up to 3 MB · 128 × 128 minimum.');return;}
    setState('checking','Checking your image…');
    try{
      if(!file.size||file.size>IMAGE_MAX_BYTES)throw Error('Choose an image smaller than 3 MB.');
      const bytes=new Uint8Array(await file.arrayBuffer());checkStillImage(bytes);if(request!==revision)return;
      objectUrl=URL.createObjectURL(file);const result=await probe(objectUrl,aborter.signal);if(request!==revision)return;
      source={image:result.image,name:file.name};editor.open(result.image);
      setState('editing','Adjust your circular logo below, then choose Save logo.');
    }catch(e){if(request===revision){release();paint('');setState('error',e.message);}}
  }
  function chooseUrl(){
    const value=$('launchLogo').value.trim(),request=begin();$('launchImageFile').value='';if(!value){setState('empty','PNG, JPG, or WebP · Up to 3 MB · 128 × 128 minimum.');return;}
    setState('checking','Checking the image URL…');urlTimer=setTimeout(async()=>{try{const src=await verifyLaunchImage(value,aborter.signal);if(request!==revision)return;readyUrl=src;paint(src);setState('ready','Image loaded. It will be checked again before launch.');}catch(e){if(request===revision)setState('error',e.message);}},350);
  }
  function sessionValid(who,epoch){const session=getSession();if(session.who!==who||session.epoch!==epoch)throw Error('Your wallet changed. Review the image again.');}
  async function prepare(who,epoch){
    if(state==='editing')throw Error('Save or cancel your logo edits before reviewing the launch.');
    if(state==='checking'||state==='uploading')throw Error('Wait for the image to finish loading.');if(state==='error')throw Error('Choose a valid token image, or remove it to continue without an image.');
    if(!selected)return readyUrl?verifyLaunchImage(readyUrl):'';
    const file=selected,request=revision;
    if(uploaded?.digest===file.digest){const url=uploaded.url;await verifyLaunchImage(url);sessionValid(who,epoch);if(request!==revision)throw Error('The image changed. Review it again.');return url;}
    setState('uploading','Confirm the free image-upload message in your wallet. This does not approve a token transaction.');
    try{
      sessionValid(who,epoch);const signer=await getSigner(who,epoch),issuedAt=Math.floor(Date.now()/1000),signature=await signer.signMessage(imageUploadMessage(who,file.digest,issuedAt));sessionValid(who,epoch);
      if(request!==revision)throw Error('The image changed. Review it again.');
      setState('uploading','Uploading and verifying your image…');
      let binary='';for(let offset=0;offset<file.bytes.length;offset+=32768)binary+=String.fromCharCode(...file.bytes.subarray(offset,offset+32768));
      const response=await fetch('/api/lp-upload-image',{method:'POST',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(30000),body:JSON.stringify({address:who,sha256:file.digest,issuedAt,signature,image:btoa(binary)})});
      const body=await response.json();if(!response.ok)throw Object.assign(Error(body.error||'Image upload failed. Please try again.'),{status:response.status});const url=uploadedImageUrl(body.url);if(!url)throw Error('Image hosting returned an invalid image address.');
      sessionValid(who,epoch);if(request!==revision)throw Error('The image changed. Review it again.');await verifyLaunchImage(url);
      sessionValid(who,epoch);if(request!==revision)throw Error('The image changed. Review it again.');
      uploaded={digest:file.digest,url};readyUrl=url;paint(url);setState('ready','Uploaded and verified · '+body.width+' × '+body.height+' · Ready to launch.');return url;
    }catch(e){if(request===revision){const invalid=[400,413,415].includes(e.status);if(invalid)paint('');const message=e.code==='ACTION_REJECTED'?'Image upload cancelled. Your image is still selected; you can try again.':['AbortError','TimeoutError'].includes(e.name)?'Image upload timed out. No token was launched; please try again.':e.message;setState(invalid?'error':'ready',message);}throw e;}
  }
  $('launchImageFile').addEventListener('change',()=>chooseFile($('launchImageFile').files?.[0]));$('launchLogo').addEventListener('input',chooseUrl);
  $('launchImageRemove').onclick=clear;
  $('launchImageEdit').onclick=()=>{if(!source||state==='uploading')return;revision++;onChange();editor.open(source.image,selected.crop);setState('editing','Drag to reposition, zoom, or rotate. Save logo applies your changes.');};
  $('launchImagePreview').addEventListener('error',()=>{if(state==='ready'){paint('');setState('error','The selected image is no longer available. Select it again before launching.');}});
  return {prepare,canReview:()=>state==='ready'||state==='empty'};
}
