import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const context=vm.createContext({TextEncoder,TextDecoder,Uint8Array,URLSearchParams});
vm.runInContext(readFileSync(new URL('../assets/vote-contract.js',import.meta.url),'utf8'),context);
const v=context.RWIContractVotes,who='0x'+'1'.repeat(40),attacker='0x'+'2'.repeat(40),H='0x'+'a'.repeat(64),BH='0x'+'b'.repeat(64),N=v.START_BLOCK+1;
const manifest=JSON.parse(readFileSync(new URL('../integrations/bankr-voting-legacy.json',import.meta.url),'utf8'));
assert.equal(manifest.selector+manifest.recipientWord+manifest.amountWord,v.PREFIX);assert.equal(manifest.acceptedFromBlock,v.START_BLOCK);
const built=v.makeVote(12,'gg-6677e92c-6f08-5239-860a-bc5e6ca1cff2');
assert.equal(built.to,v.TOKEN);assert.equal(built.value,'0');assert.equal(built.chainId,4663);assert.equal(v.parseVoteInput(built.data).round,12);
const log={address:v.TOKEN,topics:[v.TRANSFER,'0x'+who.slice(2).padStart(64,'0'),'0x'+v.INBOX.slice(2).padStart(64,'0')],data:'0x'+'0'.repeat(64),transactionHash:H,blockHash:BH,blockNumber:N,transactionIndex:2,logIndex:4};
const tx={...built,hash:H,from:who,input:built.data,blockHash:BH,blockNumber:N,transactionIndex:2};
const receipt={transactionHash:H,from:who,to:v.TOKEN,blockHash:BH,blockNumber:N,transactionIndex:2,status:'0x1',logs:[log]};
const row=v.verifyVote(tx,receipt);assert.equal(row.from,who);assert.equal(row.block_number,N);assert.equal(Buffer.from(row.input.slice(2),'hex').toString(),'RWIVOTE:12:gg-6677e92c-6f08-5239-860a-bc5e6ca1cff2');
for(const input of [built.data+'00','0x'+built.data.slice(2).replace('a9059cbb','23b872dd'),built.data.slice(0,10)+'1'+built.data.slice(11),built.data.slice(0,137)+'1'+built.data.slice(138),'0x'+Buffer.from('RWIVOTE:12:rmhc').toString('hex')])assert.equal(v.parseVoteInput(input),null);
for(const [round,slug] of [[0,'rmhc'],[1,'bad:slug'],[1,'x\n'],[1,'a'.repeat(97)],[Number.MAX_SAFE_INTEGER+1,'a']])assert.throws(()=>v.makeVote(round,slug));
assert.equal(v.verifyVote({...tx,value:'1'},receipt),null);assert.equal(v.verifyVote(tx,{...receipt,status:'0x0'}),null);
assert.equal(v.verifyVote({...tx,to:v.INBOX},receipt),null);assert.equal(v.verifyVote(tx,{...receipt,logs:[]}),null);
assert.equal(v.verifyVote({...tx,from:attacker},{...receipt,from:attacker}),null,'zero transferFrom event cannot impersonate the voter');
assert.throws(()=>v.verifyVote(tx,{...receipt,blockHash:H}));assert.throws(()=>v.verifyVote(tx,{...receipt,transactionIndex:3}));
let blockHash=BH,failed=false,readLogCalls=0;
const rpc=async(method,params)=>{
 if(method==='eth_getBlockByNumber')return {number:'0x'+N.toString(16),hash:blockHash};
 if(method==='eth_getLogs'){readLogCalls++;return [log];}
 if(method==='eth_getTransactionByHash')return tx;
 if(method==='eth_getTransactionReceipt')return receipt;
 throw Error(method);
};
const fetcher=async()=>({ok:!failed,json:async()=>({items:[],next_page_params:null})});
const reader=v.createReader();const first=await reader({rpc,fetcher});assert.equal(first.rows.length,1,'RPC covers explorer indexing lag');
assert.equal((await reader({rpc,fetcher})).rows.length,1);assert.equal(readLogCalls,1,'reuse a canonical recent window');
failed=true;await assert.rejects(reader({rpc,fetcher}),/history unavailable/);failed=false;
await assert.rejects(v.createReader()({rpc:async(m,p)=>m==='eth_getTransactionReceipt'?null:rpc(m,p),fetcher}),/not available/);
const indexed=async()=>({ok:true,json:async()=>({items:[{token:{address_hash:v.TOKEN},to:{hash:v.INBOX},total:{value:'0'},transaction_hash:H,block_number:N}],next_page_params:null})});
assert.equal((await v.createReader()({rpc,fetcher:indexed})).rows.length,1,'indexed and RPC copies deduplicate');
// Existing tally merges both transports by wallet and block/transaction order.
const html=readFileSync(new URL('../vote.html',import.meta.url),'utf8');
const tallyCode=html.slice(html.indexOf('function paintFrom('),html.indexOf('/* The connected wallet'));
const tally=vm.createContext({ROUND:12,SLATE:['rmhc','a'],tallySeq:0,lastTally:null,votePagesTruncated:false,pendingVote:null,RWI:v.TOKEN,
 $:()=>({textContent:''}),t:x=>x,Date,votePrefix:()=> 'RWIVOTE:12:',fromHexUtf8:h=>Buffer.from(h.slice(2),'hex').toString(),erc20BalanceOf:async()=>100n,paintTally(){},showMyVote(){}});
vm.runInContext(tallyCode,tally);
const makeRow=(slug,block,index,from=who)=>({from,input:'0x'+Buffer.from('RWIVOTE:12:'+slug).toString('hex'),block_number:block,index});
await tally.loadTally([makeRow('a',2,1),makeRow('rmhc',2,2)]);assert.equal(tally.lastTally.counted,1);assert.equal(tally.lastTally.latestMap.get(who).slug,'rmhc');
console.log('PASS: exact zero-transfer encoding, sender/receipt/event authentication, transferFrom impersonation rejection, malformed/nonzero/reverted calls, RPC indexing-lag coverage, deduplication, cached reads, fail-closed history, and mixed-format latest-vote counting.');
