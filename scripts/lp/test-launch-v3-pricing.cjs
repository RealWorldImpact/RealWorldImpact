const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict'),esbuild=require('esbuild');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'rwi-v3-pricing-'));
function bundle(name){const out=path.join(folder,name+'.cjs');esbuild.buildSync({entryPoints:[path.join(__dirname,name+'.js')],outfile:out,bundle:true,platform:'node',format:'cjs'});return require(out);}
const P=bundle('launch-v3-pricing'),M=bundle('launch-v3-model'),supply=999925641741752859464605861n;
(async()=>{
 for(const price of ['0.0000000001','0.00002728163605','0.00005','0.001','1','5000','5000000']){
  const t=M.launchTerms(price,supply);assert.equal(t.graduationTargetUsd,'50000');assert(Math.abs(Number(t.marketCapUsd)-5000)<1e-6);assert(BigInt(t.graduationQuote)<supply/100n);
  assert.equal(BigInt(t.soldTokens)+BigInt(t.poolTokens)+BigInt(t.lockedTokens),10n**27n);assert.equal(t.targetMarketCapUsd,'5000');
 }
 const now=Date.now(),body={chainId:4663,prices:{[P.LAUNCH_RWI]:'0.00002728163605'},quotedAt:{[P.LAUNCH_RWI]:now}},q=P.readLaunchQuote(body,supply,now);
 P.validateLaunchReview(q,q,now);assert(Number(q.lockedPercent)>97);assert(Number(q.netReserveUsd)<300);assert(Number(q.poolLiquidityUsd)<600);
 for(const key of ['openingCapRwi','phantomQuote','initialTokens','reservedTokens','graduationQuote','rwiReserveCap'])assert.throws(()=>P.validateLaunchReview(q,{...q,[key]:(BigInt(q[key])+1n).toString()},now),/changed/);
 for(const invalid of [{...body,chainId:1},{...body,prices:{}},{...body,quotedAt:{}},{...body,quotedAt:{[P.LAUNCH_RWI]:now-120001}},{...body,quotedAt:{[P.LAUNCH_RWI]:now+6000}}])assert.throws(()=>P.readLaunchQuote(invalid,supply,now));
 assert.throws(()=>P.validateLaunchReview({...q,quotedAt:now-120001},q,now),/expired/);assert.throws(()=>M.launchTerms('0',supply));assert.throws(()=>M.launchTerms('1',0n));
 assert.equal(M.graduationProgress({phantomQuote:'100',graduationQuote:'200',quoteReserve:'100'}),50);assert.equal(M.graduationProgress({phantomQuote:'100',quoteReserve:'125'}),50);
 const chain=M.curveTerms(q.openingCapRwi,supply/100n);M.assertOnchainTerms(q,chain);assert.throws(()=>M.assertOnchainTerms(q,{...chain,initialTokens:chain.initialTokens+1n}),/allocation changed/);
 const old=global.fetch;try{
  global.fetch=async url=>{assert(url.includes('fresh=1'));return {ok:true,json:async()=>body}};
  const rpc={call:async tx=>{assert.equal(tx.data,'0x18160ddd');return '0x'+supply.toString(16).padStart(64,'0')}};
  assert.equal((await P.fetchLaunchQuote(rpc,true)).initialTokens,q.initialTokens);
  await assert.rejects(P.fetchLaunchQuote({call:async()=>{throw Error('supply unavailable')}},true),/supply unavailable/);
  global.fetch=async()=>({ok:false});await assert.rejects(P.fetchLaunchQuote(rpc,true),/price is temporarily/);
 }finally{global.fetch=old;}
 console.log('PASS: V3 $5k/$50k targets, 1% cap, allocation disclosure, fresh price/supply guards, onchain term mismatch and progress.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{for(const f of fs.readdirSync(folder))fs.unlinkSync(path.join(folder,f));fs.rmdirSync(folder)});
