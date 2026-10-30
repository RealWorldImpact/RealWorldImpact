const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),esbuild=require('esbuild');
const file=path.join(os.tmpdir(),'lp-amounts-'+process.pid+'.cjs');
esbuild.buildSync({entryPoints:[path.join(__dirname,'deposit-amounts.js')],outfile:file,bundle:true,platform:'node',format:'cjs'});
const {percentageAmount}=require(file);fs.unlinkSync(file);
const balance=81889360383037062784676100n;
assert.equal(percentageAmount(balance,0),0n);assert.equal(percentageAmount(balance,100),balance);assert.equal(percentageAmount(balance,25),balance/4n);
assert.equal(percentageAmount(1000001n,50),500000n);assert.equal(percentageAmount(1n,99),0n);
for(let percent=0;percent<=100;percent++)assert(percentageAmount(balance,percent)<=balance);
for(const percent of [-1,101,0.5,NaN])assert.throws(()=>percentageAmount(balance,percent));
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
