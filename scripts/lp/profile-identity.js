import { sha256 } from 'ethers';
import { PROFILE_API,profileFields,profileUpdateMessage,readPublicProfile } from './profile-policy.js';
import { IMAGE_MAX_BYTES,checkStillImage,checkImageDimensions } from './launch-image-policy.js';
import { createImageCropEditor } from './launch-image-editor.js';
import { ownsProfile } from './profile-model.js';
const $=id=>document.getElementById(id);
function loadImage(src){return new Promise((resolve,reject)=>{const img=new Image(),timer=setTimeout(()=>done(Error('The image took too long to load. Try another file.')),12000);function done(e){clearTimeout(timer);img.onload=img.onerror=null;e?reject(e):resolve(img);}img.onload=()=>{try{checkImageDimensions(img.naturalWidth,img.naturalHeight);done();}catch(e){done(e);}};img.onerror=()=>done(Error('This image could not be opened. Choose another image.'));img.src=src;});}
export function createProfileIdentity({getSubject,getAccount,getSession,getSigner,isBusy}){
  let subject=null,revision=0,record=null,loading=null,loadedAt=0,editorBase=null,ownerSession=null,working=false,editingCrop=false,selection=0,selected=null,imageAction='keep',sourceUrl=null,cropUrl=null,source=null;
  const crop=createImageCropEditor({prefix:'profileImage',onApply:async blob=>{const current=selection,bytes=new Uint8Array(await blob.arrayBuffer());if(current!==selection)return;if(bytes.length>IMAGE_MAX_BYTES)throw Error('The cropped photo is too large. Choose another file.');selected={bytes,digest:sha256(bytes)};imageAction='upload';if(cropUrl)URL.revokeObjectURL(cropUrl);cropUrl=URL.createObjectURL(blob);paintEditor(cropUrl);editingCrop=false;message('Photo ready. Save profile to publish it.');buttons();},onCancel(){editingCrop=false;paintEditor(imageAction==='remove'?'':cropUrl||editorBase?.avatar||'');message('Photo editing cancelled.');buttons();},onError(e){message(e.message,true);}});
  function message(text,error=false){$('profileEditStatus').textContent=text;$('profileEditStatus').classList.toggle('error',error);}
  function buttons(){$('profileSave').disabled=working||editingCrop||!editorBase||isBusy();$('profileImageFile').disabled=working;$('profileImageRemove').disabled=working||editingCrop;$('profileImageRemove').hidden=imageAction==='remove'||!editorBase?.avatar&&!selected;$('profileEditClose').disabled=working;$('profileEditCancel').disabled=working;$('profileDisplayName').disabled=working;$('profileBioInput').disabled=working;$('profileEdit').disabled=isBusy()||working;}
  function paintEditor(url){$('profileImagePreview').hidden=!url;$('profileImageFallback').hidden=Boolean(url);if(url)$('profileImagePreview').src=url;else $('profileImagePreview').removeAttribute('src');}
  function release(){selection++;crop.close();editingCrop=false;selected=null;source=null;if(sourceUrl)URL.revokeObjectURL(sourceUrl);if(cropUrl)URL.revokeObjectURL(cropUrl);sourceUrl=cropUrl=null;}
  function render(){
    const owner=ownsProfile(subject,getAccount()),avatar=record?.avatar||'',img=$('profileAvatarImage');
    $('profileEdit').hidden=!owner;$('profileAvatarFallback').textContent=subject?subject.slice(2,4).toUpperCase():'RWI';
    if(img.getAttribute('src')!==avatar){img.hidden=!avatar;$('profileAvatarFallback').hidden=Boolean(avatar);if(avatar)img.src=avatar;else img.removeAttribute('src');}
    $('profileBio').textContent=record?.bio||(subject?owner?'Make this profile yours. Add a photo, name and a short bio.':'A public view of this wallet’s RWI activity.':'Your positions, launches and rewards in one place.');
    $('profileTitle').textContent=record?.displayName||(subject?owner?'Your profile':subject.slice(0,6)+'…'+subject.slice(-4):'Your wallet. Your impact.');
    $('profileCustomNote').hidden=!record?.displayName;$('profileImageRemove').hidden=!editorBase?.avatar&&!selected;
    buttons();
  }
  function sync(){
    const next=getSubject();if(next!==subject){subject=next;revision++;record=null;loadedAt=0;loading=null;release();$('profileEditorDialog').close();editorBase=null;$('profilePublicStatus').textContent='';}
    if(ownerSession&&(!ownsProfile(subject,getAccount())||getSession().epoch!==ownerSession.epoch)){$('profileEditorDialog').close();release();editorBase=null;ownerSession=null;}
    render();
  }
  async function read(address){const response=await fetch(PROFILE_API+'&address='+address,{cache:'no-store',signal:AbortSignal.timeout(15000)});const body=await response.json();if(!response.ok)throw Error(body.error||'The public profile is unavailable.');return readPublicProfile(body,address);}
  async function load(force=false){
    if(!subject||!force&&Date.now()-loadedAt<30000)return record;if(loading&&!force)return loading;
    const who=subject,epoch=revision,task=read(who).then(data=>{if(subject===who&&revision===epoch){record=data;loadedAt=Date.now();$('profilePublicStatus').textContent='';render();}return data;}).catch(e=>{if(subject===who&&revision===epoch)$('profilePublicStatus').textContent='Profile details are temporarily unavailable. Retrying automatically.';throw e;}).finally(()=>{if(loading===task)loading=null;});loading=task;return task;
  }
  async function open(){
    if(isBusy()||working||!ownsProfile(subject,getAccount()))return;release();editorBase=null;imageAction='keep';ownerSession={...getSession()};const expected=ownerSession,who=subject;
    $('profileEditorDialog').showModal();message('Loading your public profile…');buttons();
    try{const data=await load(true);if(!$('profileEditorDialog').open||subject!==who||ownerSession!==expected)return;session();editorBase=data;$('profileDisplayName').value=data.displayName;$('profileBioInput').value=data.bio;paintEditor(data.avatar);$('profileImageFile').value='';render();message('Your photo, name and bio will be visible to everyone. Saving uses a free wallet signature.');}
    catch(e){message(e.message,true);}finally{buttons();}
  }
  function session(){const current=getSession();if(!ownerSession||current.who!==ownerSession.who||current.epoch!==ownerSession.epoch||!ownsProfile(subject,current.who))throw Error('Your wallet changed. Reopen the profile editor.');}
  async function choose(file){
    if(working||!file)return;selection++;const request=selection;editingCrop=true;crop.close();buttons();message('Checking photo…');
    try{if(!file.size||file.size>IMAGE_MAX_BYTES)throw Error('Choose an image smaller than 3 MB.');const bytes=new Uint8Array(await file.arrayBuffer());checkStillImage(bytes);if(request!==selection)return;const url=URL.createObjectURL(file);let image;try{image=await loadImage(url);}catch(e){URL.revokeObjectURL(url);throw e;}if(request!==selection){URL.revokeObjectURL(url);return;}if(sourceUrl)URL.revokeObjectURL(sourceUrl);sourceUrl=url;source=image;crop.open(image);message('Drag to reposition, zoom or rotate. Choose Use photo when ready.');}
    catch(e){if(request===selection){editingCrop=false;message(e.message,true);buttons();}}
  }
  async function save(event){
    event.preventDefault();if(working||editingCrop||!editorBase||isBusy())return;working=true;buttons();const who=subject,epoch=revision;
    try{
      session();const fields=profileFields({displayName:$('profileDisplayName').value,bio:$('profileBioInput').value});
      const input={address:ownerSession.who,...fields,revision:editorBase.revision,imageAction,sha256:selected&&imageAction==='upload'?selected.digest:'',issuedAt:Math.floor(Date.now()/1000)};
      message('Confirm the free profile update message in your wallet. No transaction or token approval.');
      const signer=await getSigner(ownerSession.who,ownerSession.epoch);session();input.signature=await signer.signMessage(profileUpdateMessage(input));session();
      if(imageAction==='upload'){let binary='';for(let i=0;i<selected.bytes.length;i+=32768)binary+=String.fromCharCode(...selected.bytes.subarray(i,i+32768));input.image=btoa(binary);}
      message('Publishing your public profile…');const response=await fetch(PROFILE_API,{method:'POST',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(40000),body:JSON.stringify(input)}),body=await response.json();if(!response.ok)throw Error(body.error||'Your profile could not be saved. Try again.');
      const data=readPublicProfile(body,who);if(subject!==who||revision!==epoch)return;record=data;loadedAt=Date.now();render();$('profileEditorDialog').close();release();$('profilePublicStatus').textContent='Public profile saved. Everyone with your profile link can see it.';$('profileEdit').focus();
    }catch(e){if(subject===who&&revision===epoch)message(e.code==='ACTION_REJECTED'||e.code===4001?'Signature cancelled. Your public profile is unchanged.':['TimeoutError','AbortError'].includes(e.name)?'The save timed out. Reopen the editor to check whether it completed before trying again.':e.message,true);}
    finally{working=false;buttons();}
  }
  $('profileEdit').onclick=open;$('profileEditForm').onsubmit=save;
  $('profileImageFile').addEventListener('change',()=>choose($('profileImageFile').files?.[0]));
  $('profileImageRemove').onclick=()=>{if(working)return;release();imageAction='remove';paintEditor('');$('profileImageFile').value='';message('Photo removed from this draft. Save profile to publish the change.');buttons();};
  $('profileAvatarImage').addEventListener('error',()=>{$('profileAvatarImage').hidden=true;$('profileAvatarFallback').hidden=false;});
  $('profileImagePreview').addEventListener('error',()=>{paintEditor('');message('The photo could not load. Choose it again before saving.',true);if(imageAction==='upload'){selected=null;imageAction='keep';}});
  for(const id of ['profileEditClose','profileEditCancel'])$(id).onclick=()=>{if(!working)$('profileEditorDialog').close();};
  $('profileEditorDialog').addEventListener('cancel',e=>{if(working)e.preventDefault();});
  $('profileEditorDialog').addEventListener('close',()=>{release();editorBase=null;ownerSession=null;});
  return {sync,load,updateDisabled:buttons};
}
