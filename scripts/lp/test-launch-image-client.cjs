const assert=require('node:assert/strict');
(async()=>{
 const {createLaunchImageController}=await import('./launch-image-client.js');
 const {IMAGE_STORE_ORIGIN}=await import('./launch-image-policy.js');
 const who='0x'+'1'.repeat(40),url=IMAGE_STORE_ORIGIN+'/launch-images/v1/'+who+'/2026-10-30/'+'a'.repeat(64)+'.png';
 const context={clearRect(){},save(){},beginPath(){},arc(){},clip(){},translate(){},rotate(){},scale(){},drawImage(){},restore(){}};
 let pendingBlob=null,deferBlob=false;
 function element(){return {value:'',hidden:false,classList:{toggle(){}},events:{},focus(){},setAttribute(k,v){this[k]=v},getContext:()=>context,getBoundingClientRect:()=>({width:280}),setPointerCapture(){},toBlob(callback){if(deferBlob)pendingBlob=callback;else callback(new Blob([png],{type:'image/png'}));},addEventListener(name,fn){this.events[name]=fn},removeAttribute(name){delete this[name]}};}
 const nodes=new Map();global.document={createElement:element,getElementById(id){if(!nodes.has(id))nodes.set(id,element());return nodes.get(id)}};
 global.Image=class{naturalWidth=512;naturalHeight=512;set src(value){this._src=value;if(value)queueMicrotask(()=>value.includes('missing')?this.onerror?.():this.onload?.())}get src(){return this._src}};
 let session={who,epoch:1},signs=0,uploads=0,fetchStatus=200,sign=async()=>{signs++;return '0x'+'1'.repeat(130)};
 global.fetch=async()=>{uploads++;return {ok:fetchStatus===200,status:fetchStatus,json:async()=>fetchStatus===200?{url,width:512,height:512}:{error:'Hosting unavailable'}}};
 const ui=createLaunchImageController({getSession:()=>session,getSigner:async()=>({signMessage:m=>sign(m)}),onChange(){},onState(){}}),node=id=>document.getElementById(id);
 const png=Buffer.from([137,80,78,71,13,10,26,10,...Array(30).fill(0)]),file=new File([png],'artwork.png',{type:'image/png'});
 async function choose(value,save=true){node('launchImageFile').files=[value];await node('launchImageFile').events.change();if(save&&!node('launchImageEditor').hidden)await node('launchImageApply').onclick();}
 assert.equal(ui.canReview(),true);await choose(new File(['not an image'],'bad.png'));assert.equal(ui.canReview(),false);assert.match(node('launchImageStatus').textContent,/PNG/);
 node('launchImageRemove').onclick();assert.equal(ui.canReview(),true);assert.equal(node('launchImagePreview').hidden,true);
 await choose(file);assert.equal(ui.canReview(),true);assert.equal(node('launchImagePreview').hidden,false);
 node('launchImageEdit').onclick();assert.equal(ui.canReview(),false);await assert.rejects(ui.prepare(who,1),/Save or cancel/);node('launchImageCancel').onclick();assert.equal(ui.canReview(),true);assert.equal(node('launchImagePreview').hidden,false);
 fetchStatus=503;await assert.rejects(ui.prepare(who,1),/Hosting/);assert.equal(ui.canReview(),true,'temporary failures remain retryable');
 fetchStatus=200;assert.equal(await ui.prepare(who,1),url);const priorSigns=signs,priorUploads=uploads;assert.equal(await ui.prepare(who,1),url);assert.equal(signs,priorSigns);assert.equal(uploads,priorUploads,'review retries reuse the hosted image');
 node('launchImageEdit').onclick();node('launchImageCancel').onclick();assert.equal(await ui.prepare(who,1),url);assert.equal(uploads,priorUploads,'cancelling edits retains the verified upload');
 await choose(file,false);assert.equal(ui.canReview(),false);deferBlob=true;const oldSave=node('launchImageApply').onclick();node('launchImageRemove').onclick();pendingBlob(new Blob([png]));await oldSave;deferBlob=false;assert.equal(node('launchImagePreview').hidden,true,'late crops cannot restore removed images');assert.equal(ui.canReview(),true);
 await choose(file);let resolveSign;sign=()=>new Promise(resolve=>{resolveSign=resolve});const pending=ui.prepare(who,1);await new Promise(resolve=>setImmediate(resolve));node('launchImageRemove').onclick();resolveSign('0x'+'1'.repeat(130));await assert.rejects(pending,/image changed/);assert.equal(uploads,priorUploads,'changed selections must not upload');assert.equal(node('launchImagePreview').hidden,true);
 await choose(file);sign=async()=>{session={who:'0x'+'2'.repeat(40),epoch:2};return '0x'+'1'.repeat(130)};await assert.rejects(ui.prepare(who,1),/wallet changed/);assert.equal(uploads,priorUploads,'changed wallets must not upload');session={who,epoch:1};
 node('launchImageRemove').onclick();node('launchLogo').value='https://example.com/missing.png';node('launchLogo').events.input();assert.equal(ui.canReview(),false);await new Promise(resolve=>setTimeout(resolve,400));assert.equal(ui.canReview(),false);
 node('launchLogo').value='https://example.com/logo.png';node('launchLogo').events.input();await new Promise(resolve=>setTimeout(resolve,400));assert.equal(ui.canReview(),true);assert.equal(await ui.prepare(who,1),'https://example.com/logo.png');assert.equal(uploads,priorUploads,'URL mode does not upload a file');
 node('launchImagePreview').events.error();assert.equal(ui.canReview(),false);assert.equal(node('launchImagePreview').hidden,true,'a later image failure cannot leave a broken preview');
 node('launchImageRemove').onclick();await choose(file,false);node('launchImageCancel').onclick();assert.equal(ui.canReview(),true);assert.equal(node('launchImagePreview').hidden,true,'cancelling a new upload removes its unsaved crop');
 console.log('PASS: browser upload validation, crop save/cancel, pending crop cancellation, removal, retry, deduplication, changed images/wallets, URL failures and broken-preview protection. No transactions submitted.');
})().catch(e=>{console.error(e);process.exitCode=1});
