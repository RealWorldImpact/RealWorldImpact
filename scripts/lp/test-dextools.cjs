const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),esbuild=require('esbuild');
const {Interface,parseEther}=require('ethers'),Ajv=require('ajv');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'rwi-dextools-')),file=path.join(tmp,'adapter.cjs');
esbuild.buildSync({entryPoints:[path.join(__dirname,'server/dextools-adapter.js')],outfile:file,bundle:true,platform:'node',format:'cjs'});
const {createDextoolsAdapter,applyCurveEvent,RWI}=require(file),build=JSON.parse(fs.readFileSync(path.join(__dirname,'../../assets/launch-v5-contract.json'))),fi=new Interface(build.factory.abi);
const F='0xc62df02c2d09431a03f9022b979cdbb77bca58ed',T='0x'+'1'.repeat(40),C='0x'+'2'.repeat(40),MAKER='0x'+'3'.repeat(40),TRADER='0x'+'4'.repeat(40),Z='0x'+'0'.repeat(40),W=10n**18n,B=102689068;
const hash=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),hex=n=>'0x'+n.toString(16),stamp=n=>1000000000+n;
const log=(name,args,n,index,txIndex)=>{const x=fi.encodeEventLog(fi.getEvent(name),args);return {address:F,blockNumber:hex(n),blockHash:hash(n),transactionHash:hash(n*10+txIndex),transactionIndex:hex(txIndex),logIndex:hex(index),topics:x.topics,data:x.data,removed:false};};
const logs=[log('TokenLaunched',[T,C,100n*W,1000n*W,W,300],B+1,7,1),log('CurveTrade',[T,TRADER,true,100n*W,10n*W,4n*W],B+2,8,2),log('CurveTrade',[T,TRADER,false,46n*W,5n*W,2n*W],B+2,11,3),log('PoolGraduated',[T,hash(8),9,48n*W,20n*W,975n*W],B+3,14,2)];
const ti=new Interface(['function name() view returns(string)','function symbol() view returns(string)','function totalSupply() view returns(uint256)','function logo() view returns(string)']);
const schemas=require('./test-fixtures/dextools.schemas.json'),ajv=new Ajv({strict:false});ajv.addFormat('int64',{type:'number',validate:Number.isSafeInteger});ajv.addFormat('int32',{type:'number',validate:Number.isSafeInteger});
const validators=Object.fromEntries(['Block','Asset','Pair','Exchange','Events','Error'].map(n=>[n,ajv.compile({...schemas,$ref:'#/components/schemas/ResponseOf'+n})]));
let missing=false,duplicate=false,badReceipt=false,reorg=false,failLogs=false;
const match=(actual,want)=>want===undefined||want===null||Array.isArray(want)&&want.includes(actual)||want===actual;
async function rpc(method,params){
 if(method==='eth_getBlockByNumber'){const n=['latest','finalized'].includes(params[0])?B+20:Number(BigInt(params[0]));return {number:hex(n),timestamp:hex(stamp(n)),hash:hash(reorg&&params[0]!=='finalized'&&n===B+20?n+1:n)};}
 if(method==='eth_getLogs'){if(failLogs)throw Error('RPC failed');const q=params[0],lo=Number(BigInt(q.fromBlock)),hi=Number(BigInt(q.toBlock));let rows=logs.filter(l=>Number(BigInt(l.blockNumber))>=lo&&Number(BigInt(l.blockNumber))<=hi&&q.topics.every((t,i)=>match(l.topics[i],t)));if(missing)rows=rows.filter(l=>l!==logs[1]);if(duplicate&&rows.length)rows=[...rows,rows[0]];return rows;}
 if(method==='eth_getTransactionReceipt'){const l=logs.find(l=>l.transactionHash===params[0]);return {transactionHash:params[0],blockHash:l.blockHash,blockNumber:l.blockNumber,transactionIndex:l.transactionIndex,status:badReceipt?'0x0':'0x1',from:MAKER,logs:[l]};}
 if(method==='eth_call'){
  // Only recent state is available: any accidental archive dependency fails.
  assert.equal(Number(BigInt(params[1])),B+20,'Do not require historical state');const tx=params[0];
  if(tx.to.toLowerCase()===F){const p=fi.parseTransaction(tx);assert.equal(p.name,'launches');const owner=p.args[0].toLowerCase()===T?C:Z;return fi.encodeFunctionResult(p.name,[owner,9,hash(8),100n*W,48n*W,995n*W,1000n*W,W,48n*W,20n*W,900n*W,stamp(B+1),300,2]);}
  const p=ti.parseTransaction(tx);return ti.encodeFunctionResult(p.name,[{name:'<script>untrusted</script>',symbol:'TEST',totalSupply:1000000000n*W,logo:''}[p.name]]);
 }throw Error('Unexpected RPC '+method);
}
function response(){return {headers:{},setHeader(k,v){this.headers[k]=v},status(code){this.code=code;return this},json(body){this.body=body;return this},end(){return this}};}
async function run(h,route,query={},method='GET'){const r=response();await h({method,query:{dextools:route,...query}},r);return r;}
function valid(r,type,status=200){assert.equal(r.code,status,JSON.stringify(r.body));assert(validators[type](r.body),JSON.stringify(validators[type].errors));}
(async()=>{
 const h=createDextoolsAdapter({rpc});
 valid(await run(h,'latest-block'),'Block');valid(await run(h,'block',{number:String(B+2)}),'Block');
 const byTime=await run(h,'block',{timestamp:String(stamp(B+2))});valid(byTime,'Block');assert.equal(byTime.body.block.blockNumber,B+2);
 const precedence=await run(h,'block',{number:String(B+1),timestamp:'invalid'});valid(precedence,'Block');
 valid(await run(h,'exchange',{id:F}),'Exchange');valid(await run(h,'asset',{id:T}),'Asset');valid(await run(h,'asset',{id:RWI}),'Asset');
 const pair=await run(h,'pair',{id:T});valid(pair,'Pair');assert.equal(pair.body.pair.createdAtBlockNumber,B+1);assert.equal(pair.body.pair.feeBps,400);assert.equal(pair.body.pair.rwiCurve.phase,'graduated');
 const all=await run(h,'events',{fromBlock:String(B+1),toBlock:String(B+3)});valid(all,'Events');assert.equal(all.body.events.length,3);assert.equal(all.body.rwiMigrations.length,1);
 const [creation,buy,sell]=all.body.events;assert.equal(creation.eventType,'creation');assert.equal(buy.maker,MAKER);assert.equal(buy.rwiCurve.trader,TRADER);assert.equal(buy.eventIndex,8);assert.equal(sell.eventIndex,11);
 assert.equal(buy.asset1In,'100.0');assert.equal(buy.asset0Out,'10.0');assert.deepEqual(buy.reserves,{asset0:'990.0',asset1:'96.0'});assert.deepEqual(sell.reserves,{asset0:'995.0',asset1:'48.0'});assert.equal(sell.asset1Out,'46.0');assert.equal(sell.asset0In,'5.0');
 const slice=await run(h,'events',{fromBlock:String(B+2),toBlock:String(B+2)});valid(slice,'Events');assert.deepEqual(slice.body.events,[buy,sell]);
 const early=await run(h,'events',{fromBlock:'1',toBlock:'2'});valid(early,'Events');assert.equal(early.body.events.length,0);
 for(const [route,q,code] of [['asset',{id:'bad'},400],['asset',{id:C},404],['exchange',{id:T},404],['block',{},400],['block',{number:['1']},400],['block',{number:String(B+21)},404],['events',{fromBlock:'0',toBlock:'257'},400],['events',{fromBlock:'2',toBlock:'1'},400],['events',{fromBlock:String(B+20),toBlock:String(B+21)},400],['asset/holders',{id:T},501],['unrecognized',{},404]])valid(await run(h,route,q),'Error',code);
 assert.equal((await run(h,'events',{},'OPTIONS')).code,204);assert.equal((await run(h,'latest-block',{},'POST')).code,405);assert.equal((await run(h,'latest-block',{},'HEAD')).body,undefined);
 const q={fromBlock:String(B+2),toBlock:String(B+2)};
 missing=true;valid(await run(createDextoolsAdapter({rpc}),'events',q),'Error',503);missing=false;
 duplicate=true;valid(await run(createDextoolsAdapter({rpc}),'events',q),'Error',503);duplicate=false;
 badReceipt=true;valid(await run(createDextoolsAdapter({rpc}),'events',q),'Error',503);badReceipt=false;
 reorg=true;valid(await run(createDextoolsAdapter({rpc}),'latest-block'),'Error',503);reorg=false;
 failLogs=true;valid(await run(createDextoolsAdapter({rpc}),'latest-block'),'Error',503);failLogs=false;
 assert.throws(()=>applyCurveEvent({tokens:1n,quote:0n,initial:1n,phase:0},{name:'CurveTrade',args:{buy:false,tokenAmount:1n,rwiAmount:1n,fee:0n}}));
 console.log('PASS: official DEXTools schemas, immutable metadata, creation, exact buy/sell fee accounting, real reserves, maker/event order, graduation handoff, finalized head, timestamp lookup, archive-free replay, malformed requests, missing/duplicate logs, failed receipts and reorg rejection.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>fs.rmSync(tmp,{recursive:true,force:true}));
