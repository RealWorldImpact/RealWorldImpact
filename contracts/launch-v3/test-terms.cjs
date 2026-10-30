const fs=require('fs'),path=require('path'),assert=require('assert/strict'),esbuild=require('../../scripts/lp/node_modules/esbuild');
const {JsonRpcProvider,ContractFactory}=require('../launch/node_modules/ethers');
const artifact=n=>JSON.parse(fs.readFileSync(path.join(__dirname,'artifacts',n+'.json')));
esbuild.buildSync({entryPoints:[path.join(__dirname,'../../scripts/lp/launch-v3-model.js')],outfile:path.join(__dirname,'artifacts/model.cjs'),bundle:true,platform:'node',format:'cjs'});
const M=require('./artifacts/model.cjs');
(async()=>{
 const rpc=new JsonRpcProvider('http://127.0.0.1:8899',4663,{staticNetwork:true,cacheTimeout:-1});rpc.pollingInterval=100;
 const signer=await rpc.getSigner(0),h=await new ContractFactory(artifact('LaunchTermsHarness').abi,artifact('LaunchTermsHarness').bytecode,signer).deploy();await h.waitForDeployment();
 const cases=[];for(const opening of [10n**12n,10n**18n,10n**20n,10n**26n,10n**33n])for(const cap of [10n**12n,10n**18n,10n**25n,10n**33n])cases.push([opening,cap]);
 let seed=20261030n;const random=()=>{seed=(seed*6364136223846793005n+1442695040888963407n)%2n**128n;return seed;};
 for(let i=0;i<256;i++)cases.push([10n**12n+random()%(10n**33n-10n**12n),10n**12n+random()%(10n**33n-10n**12n)]);
 let capped=0;for(let i=0;i<cases.length;i+=16)await Promise.all(cases.slice(i,i+16).map(async([opening,cap])=>{
  const t=M.curveTerms(opening,cap),s=await h.calculate(opening,cap);M.assertOnchainTerms(t,s);
  assert(t.graduationQuote+10n<=cap);assert(t.initialTokens<=M.TOKEN_SUPPLY);assert(t.reservedTokens>0n);assert(t.initialTokens>t.reservedTokens);if(t.initialTokens<M.TOKEN_SUPPLY)capped++;
  const ratio=Number((t.phantomQuote+t.graduationQuote)*t.initialTokens)/Number(t.reservedTokens*t.phantomQuote);assert(Math.abs(ratio-10)<0.001);
  const fdvRatio=Number(t.phantomQuote*M.TOKEN_SUPPLY)/Number(t.initialTokens*opening);assert(Math.abs(fdvRatio-1)<0.000001);
  for(const tax of [0n,100n,200n,300n]){const gross=(t.graduationQuote*10000n+9899n-tax)/(9900n-tax),net=gross-gross/100n-gross*tax/10000n;assert(net>=t.graduationQuote);assert(net<=cap);}
 }));
 for(const [opening,cap] of [[0n,10n**20n],[10n**34n,10n**20n],[10n**20n,0n],[10n**20n,10n**34n]])await assert.rejects(h.calculate(opening,cap));
 const example=M.launchTerms('0.00002728163605','999925641741752859464605861');
 assert(Math.abs(Number(example.marketCapUsd)-5000)<1e-6);assert.equal(example.graduationTargetUsd,'50000');assert(Number(example.soldPercent)<2);assert(Number(example.lockedPercent)>97);assert.equal(BigInt(example.soldTokens)+BigInt(example.poolTokens)+BigInt(example.lockedTokens),M.TOKEN_SUPPLY);
 fs.writeFileSync(path.join(__dirname,'artifacts/terms-test.json'),JSON.stringify({testedAt:new Date().toISOString(),cases:cases.length,capped,example},null,2));
 console.log('PASS:',cases.length,'Solidity/JavaScript comparisons, reserve bounds for all fees, 10x valuation, supply conservation and invalid terms.');
})().catch(e=>{console.error(e);process.exitCode=1});
