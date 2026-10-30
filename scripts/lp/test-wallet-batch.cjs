const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const file=path.join(require('node:os').tmpdir(),'lp-batch-'+process.pid+'.cjs');
require('esbuild').buildSync({entryPoints:[path.join(__dirname,'wallet-batch.js')],outfile:file,bundle:true,platform:'node',format:'cjs'});
const B=require(file);fs.unlinkSync(file);
const who='0x'+'2'.repeat(40),chain=4663,hash='0x'+'a'.repeat(64),calls=[{to:who,data:'0x1234'},{to:who,data:'0xabcd',value:3n}];
function fixture(){
 const records=new Map(),requests=[];let response={status:200,chainId:'0x1237',atomic:true,receipts:[{status:'0x1',transactionHash:hash,logs:[{address:who,topics:[],data:'0x'}]}]},sendError,checks=0;
 const store={getItem:k=>records.get(k),setItem:(k,v)=>records.set(k,v),removeItem:k=>records.delete(k)};
 const provider={request:async request=>{requests.push(request);if(request.method==='wallet_getCapabilities')return {'0x1237':{atomic:{status:'supported'}}};if(request.method==='wallet_sendCalls'){if(sendError)throw sendError;return{id:request.params[0].id};}return{...response,id:response.id??requests.find(r=>r.method==='wallet_sendCalls')?.params[0].id};}};
 return{provider,store,records,requests,options:{sleep:async()=>{},attempts:2,check:async()=>{checks++;}},response:r=>response=r,error:e=>sendError=e,checks:()=>checks};
}
(async()=>{
 let f=fixture();assert.equal(await B.atomicSupport(f.provider,who,chain),true);
 assert.equal(await B.atomicSupport({request:async()=>({'0x1':{atomic:{status:'supported'}}})},who,chain),false);
 for(const status of ['ready','unsupported',undefined])assert.equal(await B.atomicSupport({request:async()=>({'0x1237':{atomic:{status}}})},who,chain),status==='ready');
 assert.equal(await B.atomicSupport({request:async()=>{throw Error('unsupported');}},who,chain),false);
 let seen;const result=await B.sendAtomicBatch(f.provider,f.store,who,chain,calls,{...f.options,onReceipt:r=>seen=r});
 const request=f.requests.find(r=>r.method==='wallet_sendCalls').params[0];assert.equal(request.atomicRequired,true);assert.equal(request.chainId,'0x1237');assert.equal(request.from,who);assert.equal(request.version,'2.0.0');assert.equal(request.calls[0].value,'0x0');assert.equal(request.calls[1].value,'0x3');assert.deepEqual(request.calls.map(c=>c.data),['0x1234','0xabcd']);assert.equal(seen.transactionHash,hash);assert.equal(result.logs.length,1);assert.equal(f.records.size,0);assert.equal(f.checks(),1);
 f=fixture();await assert.rejects(B.sendAtomicBatch(f.provider,f.store,who,chain,calls,{...f.options,check:async()=>{throw Error('Wallet changed');}}),/Wallet changed/);assert.equal(f.requests.length,0);
 f=fixture();f.error({code:4001});await assert.rejects(B.sendAtomicBatch(f.provider,f.store,who,chain,calls,f.options),/cancelled/);assert.equal(f.records.size,0);
 f=fixture();f.error(Error('Lost response'));await assert.rejects(B.sendAtomicBatch(f.provider,f.store,who,chain,calls,f.options),/Check your wallet/);assert.ok(B.pendingBatch(f.store,who,chain));f.response({chainId:'0x1237',status:100});await assert.rejects(B.sendAtomicBatch(f.provider,f.store,who,chain,calls,f.options),/still pending/);assert.equal(f.requests.filter(r=>r.method==='wallet_sendCalls').length,1);
 f=fixture();f.response({chainId:'0x1237',status:500});await assert.rejects(B.sendAtomicBatch(f.provider,f.store,who,chain,calls,f.options),/failed/);assert.equal(f.records.size,0);
 f=fixture();f.response({chainId:'0x1',status:200});await assert.rejects(B.sendAtomicBatch(f.provider,f.store,who,chain,calls,f.options),/different network/);assert.equal(f.records.size,1);
 f=fixture();f.response({chainId:'0x1237',status:200,atomic:false,receipts:[{status:'0x1'}]});await assert.rejects(B.sendAtomicBatch(f.provider,f.store,who,chain,calls,f.options),/could not verify/);assert.equal(f.records.size,1);
 f=fixture();f.response({id:'0x1234',chainId:'0x1237',status:200});await assert.rejects(B.sendAtomicBatch(f.provider,f.store,who,chain,calls,f.options),/different deposit ID/);assert.equal(f.records.size,1);
 f=fixture();f.response({chainId:'0x1237',status:200,atomic:true,receipts:[{transactionHash:'" onclick="alert(1)',status:'0x1',logs:[]}]});await assert.rejects(B.sendAtomicBatch(f.provider,f.store,who,chain,calls,f.options),/could not verify/);assert.equal(f.records.size,1);
 f=fixture();f.store.setItem('rwi-lp-batch:4663:'+who,'bad json');await assert.rejects(B.sendAtomicBatch(f.provider,f.store,who,chain,calls,f.options),/could not be read/);assert.equal(f.requests.length,0);
 console.log('PASS: atomic batching, chain capabilities, ordered calls, wallet changes, rejection, lost responses, duplicate prevention, reverts and receipt validation. No transactions submitted.');
})().catch(e=>{console.error(e);process.exitCode=1});
