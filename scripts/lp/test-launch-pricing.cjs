const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),esbuild=require('esbuild');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'rwi-launch-pricing-'));
function bundle(entry,name){const file=path.join(folder,name+'.cjs');esbuild.buildSync({entryPoints:[path.join(__dirname,entry)],outfile:file,bundle:true,platform:'node',format:'cjs'});return require(file);}
const M=bundle('launch-model.js','model'),P=bundle('launch-pricing.js','pricing'),handler=bundle('../../api/lp-token-prices.js','api').default;
function response(){return{headers:{},setHeader(k,v){this.headers[k]=v},status(c){this.code=c;return this},json(b){this.body=b;return this}};}
(async()=>{
 for(const price of ['0.0000000001','0.00002665263821','0.00005','0.001','1','5000','5000000']){
  const t=M.launchTerms(price),cap=Number(t.phantomQuote)/1e18*Number(price);assert.equal(t.targetMarketCapUsd,'5000');assert.ok(Math.abs(cap-5000)<.000001,'virtual reserve sets the $5,000 reference without tick rounding');
  assert.equal(BigInt(t.graduationThreshold),BigInt(t.phantomQuote)*5n/2n);assert.equal(BigInt(t.reservedTokens),10n**27n*BigInt(t.phantomQuote)/(BigInt(t.phantomQuote)+BigInt(t.graduationThreshold)));
  assert.ok(Math.abs(Number(t.marketCapUsd)-cap)<.000001);assert.ok(Math.abs(Number(t.graduationTargetUsd)-12500)<.000001);
 }
 const now=Date.now(),body={chainId:4663,prices:{[P.LAUNCH_RWI]:'0.00002665263821'},quotedAt:{[P.LAUNCH_RWI]:now}},q=P.readLaunchQuote(body,now);
 for(const invalid of [{...body,chainId:1},{...body,prices:{}},{...body,prices:{[P.LAUNCH_RWI]:'0'}},{...body,quotedAt:{}},{...body,quotedAt:{[P.LAUNCH_RWI]:now-120001}},{...body,quotedAt:{[P.LAUNCH_RWI]:now+6000}}])assert.throws(()=>P.readLaunchQuote(invalid,now));
 P.validateLaunchReview(q,{...q,quotedAt:now+1000},now+1000);
 assert.throws(()=>P.validateLaunchReview(q,{...q,phantomQuote:(BigInt(q.phantomQuote)+1n).toString()},now),/changed/);
 assert.throws(()=>P.validateLaunchReview({...q,targetMarketCapUsd:'10000'},q,now),/changed/);
 assert.throws(()=>P.validateLaunchReview({...q,quotedAt:now-120001},q,now),/expired/);
 const originalFetch=global.fetch,originalNow=Date.now;let clock=now,calls=0,price='0.00002665263821';
 try{
  Date.now=()=>clock;global.fetch=async url=>{calls++;assert.equal(url,'https://api.geckoterminal.com/api/v2/networks/robinhood/tokens/'+P.LAUNCH_RWI);return{ok:true,json:async()=>({data:{attributes:{address:P.LAUNCH_RWI,price_usd:price}}})}};
  let r=response();await handler({method:'GET',query:{addresses:P.LAUNCH_RWI}},r);assert.equal(r.code,200);assert.equal(calls,1);assert.equal(r.body.quotedAt[P.LAUNCH_RWI],now);P.readLaunchQuote(r.body,clock);
  clock+=1000;price='0.00003';r=response();await handler({method:'GET',query:{addresses:P.LAUNCH_RWI}},r);assert.equal(calls,1);assert.equal(r.body.quotedAt[P.LAUNCH_RWI],now,'cached prices keep their original retrieval time');
  r=response();await handler({method:'GET',query:{addresses:P.LAUNCH_RWI,fresh:'1'}},r);assert.equal(calls,2);assert.equal(r.headers['Cache-Control'],'no-store');assert.equal(r.body.prices[P.LAUNCH_RWI],price);assert.equal(r.body.quotedAt[P.LAUNCH_RWI],clock);
  global.fetch=async()=>{throw Error('offline')};r=response();await handler({method:'GET',query:{addresses:P.LAUNCH_RWI,fresh:'1'}},r);assert.equal(r.body.prices[P.LAUNCH_RWI],null);assert.equal(r.body.quotedAt[P.LAUNCH_RWI],null);assert.throws(()=>P.readLaunchQuote(r.body,clock),'fresh price failure must not fall back to a cached launch quote');
  r=response();await handler({method:'GET',query:{addresses:P.LAUNCH_RWI,fresh:'anything'}},r);assert.equal(r.code,400);
  global.fetch=async(url,options)=>{assert.match(url,/fresh=1/);assert.equal(options.cache,'no-store');return{ok:true,json:async()=>body}};assert.equal((await P.fetchLaunchQuote(true)).phantomQuote,q.phantomQuote);
 }finally{global.fetch=originalFetch;Date.now=originalNow;}
 const html=fs.readFileSync(path.join(__dirname,'../../LP.html'),'utf8');assert.ok(!html.includes('id="launchPrice"'));assert.ok(html.includes('Fixed target for every launch'));
 for(const tax of ['0','100','200','300'])assert.equal(M.creatorTax(tax),Number(tax));for(const invalid of ['',null,undefined,'1','99','400','10000'])assert.throws(()=>M.creatorTax(invalid));
 console.log('PASS: $5,000 target, Pons reserve/graduation ratios, varied RWI prices, fresh timestamps, outage blocking, changed/expired review and allowed creator taxes.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{for(const name of fs.readdirSync(folder))fs.unlinkSync(path.join(folder,name));fs.rmdirSync(folder)});
