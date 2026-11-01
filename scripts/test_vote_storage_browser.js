// Run the bundled harness on localhost only. Uses isolated test databases,
// never the production recovery database, and never a wallet/network call.
import {createDeploymentRecovery} from '../contracts/vote/deployment-storage.js';
const out=document.getElementById('results'),assert=(ok,message)=>{if(!ok)throw Error(message);},expectReject=async(fn,message)=>{let failed=false;try{await fn();}catch{failed=true;}assert(failed,message);};
const entry={from:'0x'+'1'.repeat(40),nonce:7,predicted:'0x'+'2'.repeat(40)},hash='0x'+'3'.repeat(64),result={version:3,address:entry.predicted,block:1,transaction:hash,runtimeHash:'0x'+'4'.repeat(64)};
const databases=[],connections=[];
function backend(){
 const name='rwi-vote-storage-qa-'+crypto.randomUUID();databases.push(name);
 return ()=>new Promise((resolve,reject)=>{const r=indexedDB.open(name,1);r.onupgradeneeded=()=>r.result.createObjectStore('recovery');r.onerror=()=>reject(r.error);r.onsuccess=()=>{connections.push(r.result);resolve(r.result);};});
}
function storage(values={}){return {getItem:key=>values[key]??null,setItem(){throw new DOMException('Storage full','QuotaExceededError');},removeItem(){throw Error('Must not remove existing site data');}};}
async function run(){
 if(!['localhost','127.0.0.1'].includes(location.hostname))throw Error('Local test harness only');
 const open=backend(),full=storage({'unrelated-profile':'leave untouched'}),a=createDeploymentRecovery({open,legacy:()=>full});
 assert((await a.load()).pending===null,'initial read');
 await a.claim(entry);await a.submitted({...entry,hash});
 const reload=createDeploymentRecovery({open,legacy:()=>full});assert((await reload.load()).pending.hash===hash,'durable reload while localStorage is full');
 await expectReject(()=>reload.claim({...entry,nonce:8}),'duplicate attempt must fail');
 await reload.complete(result);assert((await a.load()).complete.transaction===hash,'completion persists');
 assert(full.getItem('unrelated-profile')==='leave untouched','other site data preserved');
 out.textContent+='PASS: full localStorage, durable recovery, duplicate prevention, completion, unrelated data preserved.\n';
 const migration=createDeploymentRecovery({open:backend(),legacy:()=>storage({'rwi-vote-v3-pending':JSON.stringify({...entry,hash})})});
 assert((await migration.load()).pending.hash===hash,'old attempt migrated');await expectReject(()=>migration.claim(entry),'legacy attempt must block duplicates');
 const completeOnly=createDeploymentRecovery({open:backend(),legacy:()=>storage({'rwi-vote-v3-complete':JSON.stringify(result)})});
 assert((await completeOnly.load()).complete.transaction===hash,'old completion migrated');await expectReject(()=>completeOnly.claim(entry),'legacy completion must block duplicates');
 const corrupted=createDeploymentRecovery({open:backend(),legacy:()=>storage({'rwi-vote-v3-pending':'invalid-json'})});
 await expectReject(()=>corrupted.load(),'corrupt legacy details fail closed');
 out.textContent+='PASS: migration of previous attempts and completions; corrupt records block new deployment.\n';
 const openRace=backend(),first=createDeploymentRecovery({open:openRace,legacy:()=>storage()}),second=createDeploymentRecovery({open:openRace,legacy:()=>storage()});
 await Promise.all([first.load(),second.load()]);const race=await Promise.allSettled([first.claim(entry),second.claim({...entry,nonce:8})]);
 assert(race.filter(r=>r.status==='fulfilled').length===1,'atomic claim across tabs');
 const winner=(await first.load()).pending;await expectReject(()=>first.clear({...winner,nonce:99}),'different attempt cannot clear');await first.clear(winner);assert((await second.load()).pending===null,'cleared rejected attempt');
 out.textContent+='PASS: competing tabs cannot both claim deployment; only matching attempts can be cleared.\n';
 const broken=createDeploymentRecovery({open:async()=>{throw Error('Database unavailable');},legacy:()=>storage()});await expectReject(()=>broken.claim(entry),'unavailable durable storage must fail closed');
 out.textContent+='PASS: unavailable recovery storage blocks deployment.\n';
}
run().then(()=>{document.getElementById('status').textContent='All storage checks passed';}).catch(e=>{document.getElementById('status').textContent='FAILED: '+e.message;console.error(e);}).finally(async()=>{
 for(const db of connections)db.close();for(const name of databases)await new Promise(resolve=>{const r=indexedDB.deleteDatabase(name);r.onsuccess=r.onerror=r.onblocked=resolve;});
 document.getElementById('cleanup').textContent='Temporary test databases cleaned up.';
});
