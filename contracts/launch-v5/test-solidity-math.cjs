const fs=require('fs'),path=require('path'),assert=require('assert/strict'),M=require('./economics-model.cjs');
const {JsonRpcProvider,ContractFactory}=require('../launch/node_modules/ethers');
(async()=>{const rpc=new JsonRpcProvider('http://127.0.0.1:8903',4663,{staticNetwork:true,cacheTimeout:-1});rpc.pollingInterval=40;
 try{assert.equal((await rpc.send('hardhat_metadata',[])).chainId,4663);const a=JSON.parse(fs.readFileSync(path.join(__dirname,'artifacts/EconomicsHarness.json'))),h=await new ContractFactory(a.abi,a.bytecode,await rpc.getSigner(0)).deploy();await h.waitForDeployment();let checked=0,termChecks=0;
 for(const price of [10n**9n,10n**10n,10n**12n,28202504875523n,10n**15n,M.W,100n*M.W,1000000n*M.W]){
 const {phantom:p,inventory:t,reserved:r,referenceQuote:q}=M.terms(price);assert.deepEqual(Array.from(await h.terms(price)),[p,t,r,q]);termChecks++;
 for(const tax of [0,100,200,300])for(const part of [0n,1n,10n,50n,90n,99n]){
 const first=part?M.buy(p,0n,t,r,tax,q*part/100n):{out:0n,net:0n};const args=[p,first.net,t-first.out,r,tax];
 for(const input of [1n,q/100n,q,q*2n,10n**37n]){let expected;try{expected=M.buy(...args,input);}catch{await assert.rejects(h.buy(...args,input));checked++;continue;}
 assert.deepEqual(Array.from(await h.buy(...args,input)),[expected.out,expected.spent]);checked++;
 if(expected.out===t-first.out-r&&expected.spent>1n){const smaller=expected.spent-1n;assert(M.output(smaller-M.fee(smaller,tax),p+first.net,t-first.out)<expected.out);}
 }
 }}
 for(const price of [0n,1n,10n**9n-1n,1000000n*M.W+1n])await assert.rejects(h.terms(price));
 const report={testedAt:new Date().toISOString(),localOnly:true,termChecks,solidityIntegerComparisons:checked,checks:'Eight opening prices, all creator fees, six partial states, dust inputs and exact minimal final fill'};fs.writeFileSync(path.join(__dirname,'artifacts/math-validation.json'),JSON.stringify(report,null,2)+'\n');console.log(report);
 }finally{rpc.destroy();}})().catch(e=>{console.error(e);process.exitCode=1});
