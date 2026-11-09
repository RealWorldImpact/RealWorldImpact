import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareBallot,ballotHandler} from '../lib/bankr-ballot.js';
const native=globalThis.RWIBallot;
const deployment={version:3,status:'active',chainId:4663,address:'0x'+'5'.repeat(40),block:50,transaction:'0x'+'6'.repeat(64),runtimeHash:native.build.runtimeHash,sourceVerified:true};
const v=globalThis.RWIContractVotes, code=readFileSync(new URL('./fixtures/rwi-vote-runtime.hex',import.meta.url),'utf8').trim();
const owner='0x9cd7c9196a4c1836a3df089cb210272e07e6a5e5', voter='0x'+'1'.repeat(40), burn='0x000000000000000000000000000000000000dead';
const hex=n=>'0x'+n.toString(16), hash=n=>'0x'+n.toString(16).padStart(64,'0'), memo=s=>'0x'+Buffer.from(s).toString('hex');
const bee='gg-1ada1cd1-03fa-58a7-9e26-804dd32749ca', carbon='gg-9107ce42-47d8-5068-b4c8-ef2ebd019ad2';
const now=1793488000000, stamp=Math.floor(now/60000)*60-120;
let rows, transfers, payments, chainId, runtime, badReceipt, times, networkDown, late;
const row=(id,from,block,text)=>({hash:hash(id),from:{hash:from},to:{hash:v.INBOX},block_number:block,position:2,raw_input:memo(text),status:'ok',timestamp:new Date(stamp*1000).toISOString()});
function reset(){
  rows=[row(1,owner,100,'RWIROUND:12:rmhc,'+bee+',globaldisaster'),row(2,voter,102,'RWIWRITEIN:12:'+carbon+':'+(stamp-120))];
  transfers=[{transaction_hash:hash(3),from:{hash:voter},to:{hash:burn},block_number:103,token:{address_hash:v.TOKEN}}];
  payments=500n;chainId='0x1237';runtime=code;badReceipt=false;times=0;networkDown=false;late=false;
}
const directory=async()=>({charities:globalThis.RWIVoteRoster.donateGgSeeds});
const fetcher=async url=>{
  if(networkDown) return {ok:false};
  return {ok:true,json:async()=>({items:url.includes('/token-transfers?')?transfers:rows,next_page_params:null})};
};
const txFor=id=>{
  const r=rows.find(r=>r.hash===id), payment=transfers.find(t=>t.transaction_hash===id);
  if(!r&&!payment)throw Error('unexpected tx');
  const block=r?.block_number || payment.block_number;
  return {hash:id,from:r?.from.hash || voter,to:r?.to.hash || v.TOKEN,value:'0x0',input:r?.raw_input || '0x',blockNumber:hex(block),blockHash:hash(block),transactionIndex:'0x2'};
};
const rpc=async(method,p)=>{
  if(method==='eth_chainId')return chainId;
  if(method==='eth_getCode')return p[0]===deployment.address?native.build.runtimeBytecode:runtime;
  if(method==='eth_getTransactionByHash')return txFor(p[0]);
  if(method==='eth_getBlockByNumber')return {hash:hash(Number(BigInt(p[0]))),timestamp:hex(stamp)};
  if(method==='eth_getTransactionReceipt'){
    const t=txFor(p[0]);
    return {...t,transactionHash:t.hash,status:badReceipt?'0x0':'0x1',logs:t.to===v.TOKEN?[{address:v.TOKEN,topics:[v.TRANSFER,'0x'+voter.slice(2).padStart(64,'0'),'0x'+burn.slice(2).padStart(64,'0')],data:'0x'+payments.toString(16).padStart(64,'0'),logIndex:'0x0'}]:[]};
  }
  throw Error(method);
};
const quote=async at=>({quoteAt:at,token:v.TOKEN,usd:5,units:'500'});
const run=()=>prepareBallot({deployment,fetcher,rpc,directory,quote,now:()=>now+(late && times++ ? 60000:0)});
reset();let b=await run();
assert.deepEqual(b.options.map(o=>o.slug),['rmhc',bee,'globaldisaster',carbon]);
assert.equal(b.round,12); assert.equal(b.version,3); assert.equal(b.ready,true);
for(const o of b.options){const t=o.bankrRequest.transaction;assert.equal(t.to,deployment.address);assert.equal(t.value,'0');assert.equal(t.chainId,4663);assert.equal(native.parseVoteInput(t.data).slug,o.slug);assert.equal(native.parseVoteInput(t.data).round,12);}
assert.equal(b.options[1].name,'Save the Bees USA');
assert.equal(b.options[1].memo,'RWIVOTE:12:'+bee,'website charity slug must never become the vote ID');
reset();rows.push(row(4,voter,105,'RWIROUND:99:rmhc,'+bee+',globaldisaster'));assert.equal((await run()).round,12,'ignore forged controller declaration');
reset();rows.push(row(5,voter,106,'RWIWRITEIN:12:fake-charity:123'));assert.equal((await run()).options.length,4,'ignore spam nominations');
reset();payments=499n;assert.equal((await run()).options.length,3,'underpaid write-in excluded');
reset();transfers[0].block_number=101;assert.equal((await run()).options.length,3,'past burns do not pay for a later nomination');
reset();transfers[0].block_number=102;assert.equal((await run()).options.length,3,'same-block payment must follow the nomination');
reset();rows=[];await assert.rejects(run(),/confirmed ballot/,'never fabricate round 1');
reset();chainId='0x1';await assert.rejects(run(),/contract verification/);
reset();runtime='0x00';await assert.rejects(run(),/contract verification/);
reset();badReceipt=true;await assert.rejects(run(),/proof mismatch/);
reset();networkDown=true;await assert.rejects(run(),/source unavailable/);
reset();late=true;await assert.rejects(run(),/expired/);
reset();await assert.rejects(prepareBallot({deployment,fetcher,rpc,directory,quote:async()=>null,now:()=>now}),/quote unavailable/);
reset();
const previousKey=process.env.BLOCKSCOUT_PRO_API_KEY;
process.env.BLOCKSCOUT_PRO_API_KEY='test-only-not-a-real-key';
try {
  const secured=await prepareBallot({deployment,rpc,directory,quote,now:()=>now,fetcher:async url=>{
    const u=new URL(url); assert.equal(u.origin,'https://api.blockscout.com');
    assert(u.pathname.startsWith('/4663/api/v2/')); assert.equal(u.searchParams.get('apikey'),'test-only-not-a-real-key');
    return fetcher(url);
  }});
  assert(!JSON.stringify(secured).includes('test-only-not-a-real-key'),'API credentials never enter the public feed');
} finally {
  if(previousKey===undefined)delete process.env.BLOCKSCOUT_PRO_API_KEY;else process.env.BLOCKSCOUT_PRO_API_KEY=previousKey;
}
const html=readFileSync(new URL('../vote.html',import.meta.url),'utf8');
assert(html.includes('const ORG_POOL = RWIVoteRoster.orgs;') && html.includes('const TGB_DIRECTORY = RWIVoteRoster.givingBlock;'),'page and feed share the same roster');
assert(html.includes('RWIContractVotes.makeVote(voteRound, chosen)'),'website submission uses the same contract format');
await assert.rejects(prepareBallot({deployment:{...deployment,status:'awaiting_deployment',address:null}}),e=>e.code==='AWAITING_DEPLOYMENT');
await assert.rejects(prepareBallot({deployment:{...deployment,sourceVerified:false}}),/Unverified/);
reset();await assert.rejects(prepareBallot({deployment,fetcher,directory,quote,now:()=>now,rpc:(m,p)=>m==='eth_getCode'&&p[0]===deployment.address?'0x00':rpc(m,p)}),/contract verification/);
// Round 13's confirmed transactions must survive an index response that only
// contains the round declaration and no write-in fee transfers.
reset();
rows=[row(1,owner,100,'RWIROUND:13:rmhc,'+bee+',globaldisaster')];
transfers=[];
const checkpointTxs=new Map([
  ['0xc7f4e0ef51cec3bae8491643cd09816a0e0a8a4a37b497fce70b737c2824f88b',102],
  ['0x5aa57b139a438f555633822c434405c48993affc9b0688b9801f82492ebfa50c',104],
  ['0x048c114c7bb95a2c78678cbbe288f86e3e0eb32e3ea2e00a9d2ccb75327f039e',103],
  ['0xb54f37834e237ce2950a22069e00009a6327bba05199bfcdd73a9acb087f0286',105],
]);
const recoveredRpc=async(method, params)=>{
  const id=params[0], block=checkpointTxs.get(id);
  if(!block || !['eth_getTransactionByHash','eth_getTransactionReceipt'].includes(method)) return rpc(method, params);
  const isPayment=block%2===1;
  const tx={hash:id,from:voter,to:isPayment?v.TOKEN:v.INBOX,value:'0x0',
    input:isPayment?'0x':memo('RWIWRITEIN:13:no-kid-hungry:'+(stamp-120)),
    blockNumber:hex(block),blockHash:hash(block),transactionIndex:'0x2'};
  if(method==='eth_getTransactionByHash') return tx;
  const logs=isPayment?[{address:v.TOKEN,topics:[v.TRANSFER,'0x'+voter.slice(2).padStart(64,'0'),'0x'+burn.slice(2).padStart(64,'0')],data:hash(payments),logIndex:'0x0'}]:[];
  return {...tx,transactionHash:id,status:'0x1',logs};
};
const recover=()=>prepareBallot({deployment,fetcher,rpc:recoveredRpc,directory,quote,now:()=>now});
assert.equal((await recover()).options.filter(o=>o.slug==='no-kid-hungry').length,1,'recover a confirmed write-in once, despite two paid attempts');
payments=249n;
assert.equal((await recover()).options.some(o=>o.slug==='no-kid-hungry'),false,'recovery still requires the original fee');
let responseStatus,responseBody;
await ballotHandler({}, {setHeader(){},status(code){responseStatus=code;return this;},json(body){responseBody=body;}},quote,()=>prepareBallot({deployment:{...deployment,status:'awaiting_deployment',address:null}}));
assert.equal(responseStatus,503);assert.equal(responseBody.version,3);assert.equal(responseBody.reason,'awaiting_deployment');assert.equal(responseBody.ready,false);assert.equal(responseBody.options,undefined);
console.log('PASS: live round resolution, exact Save the Bees ballot ID, prepared native vote requests, paid write-ins, spoofed controllers, spam, historical/same-block/insufficient burns, unavailable proofs, stale data, and no guessed fallback.');
