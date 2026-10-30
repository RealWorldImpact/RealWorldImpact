const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),esbuild=require('esbuild');
const file=path.join(os.tmpdir(),'lp-amounts-'+process.pid+'.cjs');
esbuild.buildSync({entryPoints:[path.join(__dirname,'deposit-amounts.js')],outfile:file,bundle:true,platform:'node',format:'cjs'});
const {percentageAmount,matchDollarAmounts}=require(file);fs.unlinkSync(file);
const balance=81889360383037062784676100n;
assert.equal(percentageAmount(balance,0),0n);assert.equal(percentageAmount(balance,100),balance);assert.equal(percentageAmount(balance,25),balance/4n);
assert.equal(percentageAmount(1000001n,50),500000n);assert.equal(percentageAmount(1n,99),0n);
for(let percent=0;percent<=100;percent++)assert(percentageAmount(balance,percent)<=balance);
for(const percent of [-1,101,0.5,NaN])assert.throws(()=>percentageAmount(balance,percent));
const rwi={balance:2500n*10n**18n,decimals:18,priceUsd:'0.02'},eth={balance:2n*10n**17n,decimals:18,priceUsd:'2000'};
let match=matchDollarAmounts(rwi,eth,50);assert.equal(match.sourceAmount,1250n*10n**18n);assert.equal(match.targetAmount,125n*10n**14n);assert.equal(match.targetPercent,6.25);assert.equal(match.capped,false);
match=matchDollarAmounts(eth,rwi,100);assert.equal(match.sourceAmount,25n*10n**15n);assert.equal(match.targetAmount,rwi.balance);assert.equal(match.sourcePercent,12.5);assert.equal(match.targetPercent,100);assert.equal(match.capped,true);
match=matchDollarAmounts(rwi,eth,0);assert.equal(match.sourceAmount,0n);assert.equal(match.targetAmount,0n);
assert.equal(matchDollarAmounts({...rwi,priceUsd:null},eth,50),null);assert.equal(matchDollarAmounts(rwi,{...eth,priceUsd:'0'},50),null);
match=matchDollarAmounts({balance:123456789n,decimals:6,priceUsd:'1'},rwi,12.34);assert(match.sourceAmount<=123456789n);assert(match.targetAmount<=rwi.balance);
const apiFile=path.join(os.tmpdir(),'lp-prices-'+process.pid+'.cjs');esbuild.buildSync({entryPoints:[path.join(__dirname,'../../api/lp-token-prices.js')],outfile:apiFile,bundle:true,platform:'node',format:'cjs'});
const handler=require(apiFile).default;fs.unlinkSync(apiFile);
const a='0x'+'1'.repeat(40),b='0x'+'2'.repeat(40);
function res(){return {setHeader(){},status(n){this.code=n;return this;},json(body){this.body=body;return this;}};}
(async()=>{const original=global.fetch;try{
 global.fetch=async url=>({ok:true,json:async()=>({data:{attributes:{address:url.split('/').pop(),price_usd:'0.02'}}})});
 let r=res();await handler({method:'GET',query:{addresses:a+','+b}},r);assert.equal(r.code,200);assert.equal(r.body.prices[a],'0.02');
 r=res();await handler({method:'GET',query:{addresses:'bad'}},r);assert.equal(r.code,400);
 global.fetch=async()=>{throw Error('offline')};r=res();const c='0x'+'3'.repeat(40);await handler({method:'GET',query:{addresses:c}},r);assert.equal(r.body.prices[c],null);
 console.log('PASS: 0–100% exact holdings, dust rounding, 100% balance cap, invalid percentages, USD quote validation and unavailable prices.');
}finally{global.fetch=original;}})().catch(e=>{console.error(e);process.exitCode=1});
