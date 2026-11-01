// Wallet/RPC mocks only. This test never connects to a real wallet or network.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {getCreateAddress,keccak256,formatEther} from 'ethers';
const source=readFileSync(new URL('../contracts/vote/deploy-ui.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
const build=JSON.parse(readFileSync(new URL('../assets/vote-native-contract.json',import.meta.url)));
const from='0x'+'1'.repeat(40),nonce=42,predicted=getCreateAddress({from,nonce}),hash='0x'+'2'.repeat(64),blockHash='0x'+'3'.repeat(64);
const entry={from,nonce,predicted};
const clone=x=>structuredClone(x),drain=()=>new Promise(resolve=>setImmediate(resolve));
async function scenario(options={}){
 const nodes=new Map(),element=()=>({disabled:false,hidden:true,textContent:'',className:'',children:[],replaceChildren(){this.children=[];},append(node){this.children.push(node);}});
 const get=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
 let stored={version:1,pending:null,complete:null,...clone(options.initial||{})},sends=0,writes=0,gasEstimates=0;
 const recovery={
  load:async()=>clone(stored),
  claim:async e=>{if(options.claimFails)throw Error('Could not save deployment recovery details');assert(!stored.pending&&!stored.complete);stored.pending=clone(e);return clone(stored);},
  submitted:async e=>{if(options.hashFails)throw Error('Storage full');stored.pending=clone(e);return clone(stored);},
  complete:async r=>{if(options.completeFails)throw Error('Storage full');stored.complete=clone(r);return clone(stored);},
  clear:async()=>{if(options.clearFails)throw Error('Storage full');stored.pending=null;return clone(stored);}
 };
 const provider={request:async({method})=>method==='eth_chainId'?(options.changeChainAfterClaim&&stored.pending?'0x1':'0x1237'):[from]};
 class BrowserProvider{async getSigner(){return {
  getNonce:async()=>nonce,estimateGas:async()=>{gasEstimates++;return 100000n;},
  sendTransaction:async tx=>{assert(stored.pending,'persist before wallet request');assert.equal(tx.value,0n);assert.equal(tx.chainId,4663);assert.equal(tx.data,build.bytecode);sends++;
   if(options.reject){const e=Error('Wallet request rejected');e.code='ACTION_REJECTED';throw e;}
   if(options.waitSend)await options.waitSend;
   return {hash,wait:async()=>({status:1})};
  }
 };}}
 class JsonRpcProvider{
  async getFeeData(){return {gasPrice:1n};}async getBalance(){return 10n**18n;}
  async getCode(){return build.runtimeBytecode;}
  async getTransaction(){return {to:null,value:0n,chainId:4663n,from,nonce,data:build.bytecode,blockHash};}
  async getTransactionReceipt(){return {status:1,blockNumber:100,blockHash,contractAddress:predicted};}
  async getBlock(){return {hash:blockHash};}
 }
 const context=vm.createContext({document:{getElementById:get,createElement:element},window:{addEventListener(){},dispatchEvent(){},ethereum:provider},Event:class{},
  navigator:{clipboard:{writeText:async()=>{}}},localStorage:{getItem:()=>null,setItem(){writes++;throw Error('Quota exceeded');}},
  BrowserProvider,JsonRpcProvider,getCreateAddress,keccak256,formatEther,build,createDeploymentRecovery:()=>recovery,walletCandidates:()=>[{name:'Test wallet',provider}],fetch:async()=>({ok:true,json:async()=>({version:3,chainId:4663,runtimeHash:build.runtimeHash,status:'awaiting_deployment'})})
 });
 vm.runInContext(source,context);await drain();assert.equal(get('connect').disabled,false);
 await get('connect').onclick();await get('choices').children[0].onclick();
 return {get,stored:()=>stored,sends:()=>sends,legacyWrites:()=>writes,estimates:()=>gasEstimates};
}
let s=await scenario();assert.equal(s.sends(),0,'connection does not request deployment');await s.get('deploy').onclick();assert.equal(s.sends(),1);assert.equal(s.legacyWrites(),0);assert.equal(s.get('result').hidden,false);assert.equal(JSON.parse(s.get('result').textContent).transaction,hash);assert.equal(s.get('deploy').disabled,true);
s=await scenario({claimFails:true});await s.get('deploy').onclick();assert.equal(s.sends(),0,'durable write failure blocks submission');assert.match(s.get('status').textContent,/save deployment/);
s=await scenario({hashFails:true,completeFails:true});await s.get('deploy').onclick();assert.equal(s.sends(),1);assert(s.stored().pending&&!s.stored().pending.hash);assert.equal(s.get('result').hidden,false,'confirmation still visible if later writes fail');assert.match(s.get('status').textContent,/Deployment confirmed/);assert.match(s.get('recovery').textContent,new RegExp(hash));assert.equal(s.get('deploy').disabled,true);
await s.get('check').onclick();assert.equal(s.get('result').hidden,false,'in-memory transaction hash survives a reread');assert.equal(s.sends(),1);
s=await scenario({initial:{pending:{...entry,hash}}});assert.equal(s.estimates(),0);assert.equal(s.get('deploy').disabled,true);await s.get('check').onclick();assert.equal(s.get('result').hidden,false);assert.equal(s.sends(),0,'reload recovers without sending');
s=await scenario({reject:true});await s.get('deploy').onclick();assert.equal(s.stored().pending,null);assert.equal(s.get('deploy').disabled,true,'reconnect after rejected request');
s=await scenario({reject:true,clearFails:true});await s.get('deploy').onclick();assert(s.stored().pending);assert.equal(s.get('deploy').disabled,true);assert.match(s.get('status').textContent,/could not be cleared/);
s=await scenario({changeChainAfterClaim:true});await s.get('deploy').onclick();assert.equal(s.sends(),0);assert.equal(s.stored().pending,null,'session failure before signing releases its unused claim');
let release;const waitSend=new Promise(resolve=>{release=resolve;});s=await scenario({waitSend});const first=s.get('deploy').onclick();await drain();await s.get('deploy').onclick();assert.equal(s.sends(),1);release();await first;
console.log('PASS: no localStorage writes, durable recovery before signing, blocked failed saves, visible confirmation after later storage failures, reload recovery, rejected requests, and duplicate-click prevention. No real wallet or network used.');
