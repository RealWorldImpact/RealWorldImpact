const fs=require('fs'),path=require('path'),assert=require('assert/strict'),M=require('./economics-model.cjs');
const {JsonRpcProvider,ContractFactory}=require('../launch/node_modules/ethers');
(async()=>{
 const rpc=new JsonRpcProvider('http://127.0.0.1:8901',4663,{staticNetwork:true,cacheTimeout:-1});rpc.pollingInterval=40;assert.equal((await rpc.send('hardhat_metadata',[])).chainId,4663);
 const a=JSON.parse(fs.readFileSync(path.join(__dirname,'artifacts/EconomicsHarness.json'))),h=await new ContractFactory(a.abi,a.bytecode,await rpc.getSigner(0)).deploy();await h.waitForDeployment();
 const cases=[];let termChecks=0;
 for(const price of [10n**9n,10n**10n,10n**12n,27281636050000n,10n**15n,M.W,100n*M.W,1000000n*M.W]){
  const {phantom:p,inventory:t}=M.terms(price),onchain=await h.terms(price);assert.deepEqual(Array.from(onchain),[p,t]);termChecks++;
  for(const multiplier of [1n,10n,50n,100n,200n,1000n,10000n])for(const tax of [0,100,200,300]){
   const usd=price*multiplier/100n;if(usd<10n**9n||usd>1000000n*M.W)continue;
   for(const partial of [false,true]){const first=partial?M.buy(p,0n,t,tax,p/10000n,price):{out:0n,net:0n};cases.push({p,q:first.net,t:t-first.out,tax,usd})}
  }
 }
 for(const tax of [0,100,200,300])for(let gap=1n;gap<=100n;gap++)cases.push({p:M.W,q:M.SEED-gap,t:10n**24n,tax,usd:M.W});
 let checked=0;
 for(let i=0;i<cases.length;i+=12)await Promise.all(cases.slice(i,i+12).map(async c=>{
  const b=M.buy(c.p,c.q,c.t,c.tax,10n**37n,c.usd),chain=await h.buy(c.p,c.q,c.t,c.tax,10n**37n,c.usd);assert.deepEqual(Array.from(chain),[b.out,b.spent]);
  const q=c.q+b.net,t=c.t-b.out;assert.equal(await h.fdv(c.p,q,t,c.usd),M.fdv(c.p,q,t,c.usd));assert(await h.eligible(c.p,q,t,c.usd));
  const gross=b.spent-1n,net=gross-M.fee(gross,c.tax),out=M.output(net,c.p+c.q,c.t);assert.equal(await h.eligible(c.p,c.q+net,c.t-out,c.usd),false);checked++;
 }));
 for(const price of [0n,1n,10n**9n-1n,1000000n*M.W+1n])await assert.rejects(h.terms(price));
 const r={testedAt:new Date().toISOString(),localOnly:true,termChecks,solidityIntegerComparisons:checked,checks:'Initial and partially traded curves, exact minimal final fill, FDV and both thresholds, eight launch prices and all fees'};fs.writeFileSync(path.join(__dirname,'artifacts/math-validation.json'),JSON.stringify(r,null,2));console.log(r);
})().catch(e=>{console.error(e);process.exitCode=1});
