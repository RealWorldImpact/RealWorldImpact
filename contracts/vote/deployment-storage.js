// IndexedDB has a separate storage allowance from localStorage. Keep a durable
// attempt BEFORE requesting a signature, and atomically refuse a second attempt.
const DATABASE='rwi-vote-deployment',STORE='recovery',RECORD='v3';
const address=v=>typeof v==='string'&&/^0x[0-9a-f]{40}$/i.test(v);
const hash=v=>typeof v==='string'&&/^0x[0-9a-f]{64}$/i.test(v);
const same=(a,b)=>a&&b&&a.from.toLowerCase()===b.from.toLowerCase()&&a.predicted.toLowerCase()===b.predicted.toLowerCase()&&a.nonce===b.nonce;
function checkPending(entry){
 if(!entry||!address(entry.from)||!address(entry.predicted)||!Number.isSafeInteger(entry.nonce)||entry.nonce<0||(entry.hash!==undefined&&!hash(entry.hash)))throw Error('Saved deployment details are invalid. Check wallet history before deploying.');
}
function checkResult(result){
 if(!result||result.version!==3||!address(result.address)||!hash(result.transaction)||!hash(result.runtimeHash)||!Number.isSafeInteger(result.block)||result.block<1)throw Error('Saved deployment result is invalid. Check wallet history before deploying.');
}
function checkRecord(record){
 if(!record||record.version!==1||!Object.hasOwn(record,'pending')||!Object.hasOwn(record,'complete'))throw Error('Saved deployment details are unreadable. Check wallet history before deploying.');
 if(record.pending!==null)checkPending(record.pending);
 if(record.complete!==null)checkResult(record.complete);
 return record;
}
function legacyRecord(storage){
 try{
  const pending=storage.getItem('rwi-vote-v3-pending'),complete=storage.getItem('rwi-vote-v3-complete');
  return checkRecord({version:1,pending:pending?JSON.parse(pending):null,complete:complete?JSON.parse(complete):null});
 }catch{throw Error('Previous deployment details could not be read. Check wallet history before deploying.');}
}
function openDatabase(indexedDB){
 return new Promise((resolve,reject)=>{
  if(!indexedDB){reject(Error('Recovery storage is unavailable. No deployment request was sent.'));return;}
  let settled=false;
  const timer=setTimeout(()=>{settled=true;reject(Error('Recovery storage did not open. Close other setup tabs and reload.'));},5000);
  let request;
  try{request=indexedDB.open(DATABASE,1);}catch(e){clearTimeout(timer);reject(e);return;}
  request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE);};
  request.onerror=()=>{clearTimeout(timer);settled=true;reject(Error('Recovery storage is unavailable. No deployment request was sent.'));};
  request.onsuccess=()=>{clearTimeout(timer);if(settled){request.result.close();return;}settled=true;const db=request.result;db.onversionchange=()=>db.close();resolve(db);};
 });
}
// Dependency injection lets tests exercise storage failures without a wallet.
export function createDeploymentRecovery({open=()=>openDatabase(globalThis.indexedDB),legacy=()=>globalThis.localStorage}={}){
 let connection;
 async function update(change){
  const db=await (connection||(connection=open().catch(e=>{connection=null;throw e;})));
  return new Promise((resolve,reject)=>{
   const transaction=db.transaction(STORE,'readwrite'),store=transaction.objectStore(STORE);
   let result,failure;
   transaction.oncomplete=()=>resolve(result);
   transaction.onabort=()=>reject(failure||Error('Could not save deployment recovery details. No new deployment request was sent.'));
   transaction.onerror=()=>{}; // Abort is the authoritative failure signal.
   const request=store.get(RECORD);
   request.onsuccess=()=>{try{
    const missing=request.result===undefined;
    const previous=checkRecord(missing?legacyRecord(legacy()):request.result);
    const next=change?change(previous):null;
    result=checkRecord(next||previous);
    if(missing||next)store.put(result,RECORD);
   }catch(e){failure=e;transaction.abort();}};
  });
 }
 return {
  load:()=>update(),
  claim:entry=>{checkPending(entry);return update(record=>{
   if(record.pending||record.complete)throw Error('A deployment attempt is already saved. Check its status before continuing.');
   return {...record,pending:{...entry}};
  });},
  submitted:entry=>{checkPending(entry);if(!hash(entry.hash))throw Error('Missing deployment transaction hash');return update(record=>{
   if(!same(record.pending,entry)||record.complete||(record.pending.hash&&record.pending.hash!==entry.hash))throw Error('Deployment recovery details changed. Do not deploy again.');
   return {...record,pending:{...entry}};
  });},
  complete:result=>{checkResult(result);return update(record=>{
   if(record.complete){if(record.complete.transaction===result.transaction)return record;throw Error('A different deployment is already saved.');}
   if(!record.pending||record.pending.predicted.toLowerCase()!==result.address.toLowerCase()||(record.pending.hash&&record.pending.hash!==result.transaction))throw Error('Deployment result does not match the saved attempt.');
   return {...record,pending:{...record.pending,hash:result.transaction},complete:{...result}};
  });},
  clear:entry=>update(record=>{
   if(record.complete||!same(record.pending,entry)||(record.pending.hash&&record.pending.hash!==entry.hash))throw Error('The saved deployment cannot be cleared. Check its status.');
   return {...record,pending:null};
  })
 };
}
