// Read-only mainnet check. Never requests a wallet or submits transactions.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const esbuild=require('esbuild'),{Interface,zeroPadValue,formatUnits}=require('ethers'),Ajv=require('ajv');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'rwi-dextools-verify-')),file=path.join(tmp,'adapter.cjs');
esbuild.buildSync({entryPoints:[path.join(__dirname,'server/dextools-adapter.js')],outfile:file,bundle:true,platform:'node',format:'cjs'});
const {createDextoolsAdapter,readRpc}=require(file),fi=new Interface(JSON.parse(fs.readFileSync(path.join(__dirname,'../../assets/launch-v5-contract.json'))).factory.abi);
const F='0xc62df02c2d09431a03f9022b979cdbb77bca58ed',T='0x82e2b12864e04488f6a6a2602b30b11bb53cba91',BASE='https://www.rwihood.org/integrations/dextools';
const schemas=require('./test-fixtures/dextools.schemas.json'),ajv=new Ajv({strict:false});ajv.addFormat('int64',{type:'number',validate:Number.isSafeInteger});ajv.addFormat('int32',{type:'number',validate:Number.isSafeInteger});
const checks={},adapter=createDextoolsAdapter({onError:e=>console.error(e.message)}),live=process.argv.includes('--live'),hex=n=>'0x'+n.toString(16);
async function request(route,query,type){
 const url=BASE+'/'+route+'?'+new URLSearchParams(query);let response;
 if(live){const r=await fetch(url,{signal:AbortSignal.timeout(60000)});response={code:r.status,body:await r.json(),hash:r.headers.get('x-rwi-block-hash')};}
 else{response={headers:{},setHeader(k,v){this.headers[k]=v},status(code){this.code=code;return this},json(body){this.body=body;return this},end(){return this}};await adapter({method:'GET',query:{dextools:route,...query}},response);response.hash=response.headers['X-RWI-Block-Hash'];}
 assert.equal(response.code,200,JSON.stringify(response.body));const validate=ajv.compile({...schemas,$ref:'#/components/schemas/ResponseOf'+type});assert(validate(response.body),JSON.stringify(validate.errors));checks[url]='passed';return response;
}
(async()=>{
 const head=await request('latest-block',{},'Block'),end=head.body.block.blockNumber;
 await request('exchange',{id:F},'Exchange');await request('asset',{id:T},'Asset');
 const pair=(await request('pair',{id:T},'Pair')).body.pair;assert.equal(pair.asset0Id,T);assert.equal(pair.factoryAddress,F);
 await request('block',{number:String(pair.createdAtBlockNumber)},'Block');
 const time=(await request('block',{timestamp:String(pair.createdAtBlockTimestamp)},'Block')).body.block;assert(time.blockNumber>=pair.createdAtBlockNumber);assert.equal(time.blockTimestamp,pair.createdAtBlockTimestamp);
 const topics=['TokenLaunched','CurveTrade','PoolGraduated'].map(n=>fi.getEvent(n).topicHash),logs=[];
 for(let start=pair.createdAtBlockNumber;start<=end;start+=100000)logs.push(...await readRpc('eth_getLogs',[{address:F,fromBlock:hex(start),toBlock:hex(Math.min(end,start+99999)),topics:[topics,zeroPadValue(T,32)]}]));
 const sampleLogs=['TokenLaunched','buy','sell'].map(kind=>logs.find(l=>{const p=fi.parseLog(l);return kind==='TokenLaunched'?p.name===kind:p.name==='CurveTrade'&&p.args.buy===(kind==='buy');}));assert(sampleLogs.every(Boolean),'Test token needs finalized creation, buy and sell samples');
 const samples=[];
 for(const log of sampleLogs){const block=Number(BigInt(log.blockNumber)),data=(await request('events',{fromBlock:String(block),toBlock:String(block)},'Events')).body;
  const event=data.events.find(e=>e.txnId===log.transactionHash&&e.eventIndex===Number(BigInt(log.logIndex)));assert(event,'Missing sample event');
  const receipt=await readRpc('eth_getTransactionReceipt',[log.transactionHash]);assert.equal(Number(BigInt(receipt.status)),1);assert.equal(event.maker,receipt.from.toLowerCase());assert.equal(receipt.blockHash,log.blockHash);
  const p=fi.parseLog(log);if(p.name==='CurveTrade'){assert.equal(event[p.args.buy?'asset1In':'asset1Out'],formatUnits(p.args.rwiAmount,18));assert.equal(event[p.args.buy?'asset0Out':'asset0In'],formatUnits(p.args.tokenAmount,18));assert.equal(event.rwiCurve.feeRwi,formatUnits(p.args.fee,18));}
  samples.push({kind:p.name==='TokenLaunched'?'creation':p.args.buy?'buy':'sell',blockHash:log.blockHash,event});
 }
 const evidence={checkedAt:new Date().toISOString(),mode:live?'published-http':'local-adapter-mainnet-rpc',chainId:4663,factory:F,token:T,adapterBase:BASE,finalizedBlock:head.body.block,finalizedBlockHash:head.hash,checks,samples,limitations:['DEXTools onboarding is not approved by this verification.','Holder distribution requires DEXTools EVM indexing or an agreed balance format.','Virtual-reserve pricing and graduation handoff require DEXTools integration review.','RPC availability and cold replay limits apply; this is not an independent audit.']};
 if(process.argv.includes('--record'))fs.writeFileSync(path.join(__dirname,'../../integrations/dextools-verification.json'),JSON.stringify(evidence,null,2)+'\n');
 console.log(JSON.stringify({mode:evidence.mode,checkedAt:evidence.checkedAt,finalizedBlock:end,checks:Object.keys(checks).length,samples:samples.map(s=>({kind:s.kind,block:s.event.block.blockNumber,transaction:s.event.txnId}))},null,2));
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>fs.rmSync(tmp,{recursive:true,force:true}));
