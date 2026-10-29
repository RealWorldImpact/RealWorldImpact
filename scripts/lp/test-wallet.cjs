const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const ethers=require('ethers');
const who='0x2222222222222222222222222222222222222222';
function harness(){
 const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{id,value:'',textContent:'',innerHTML:'',hidden:false,disabled:false,classList:{toggle(){}},addEventListener(){},close(){},showModal(){},append(){}});return nodes.get(id)};
 let chain='0x1237',accounts=[who],sendCount=0,callFail=false,estimateFail=false,revert=false,afterEstimate=()=>{},afterWait=()=>{},captured;
 const store=new Map(),hash='0x'+'a'.repeat(64);
 const signer={provider:{call:async()=>{if(callFail)throw Error('preflight failed');return '0x';}},estimateGas:async()=>{if(estimateFail)throw Error('estimate failed');afterEstimate();return 100n;},sendTransaction:async req=>{sendCount++;captured=req;return{hash,wait:async()=>{afterWait();if(revert)throw {receipt:{status:0},message:'reverted'};return {hash,status:1,logs:[]}}}}};
 const provider={request:async({method})=>method==='eth_chainId'?chain:accounts};
 const ctx={console,Map,Date,Number,BigInt,JSON,Error,Promise,setTimeout,AbortSignal,AbortController,createLogoLoader:()=>({load:()=>()=>{}}),sortHoldings:x=>x,usdLabel:()=>"USD",fetch:async()=>{throw Error('unused')},navigator:{},localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)},document:{getElementById:node,querySelectorAll:()=>[],createElement:()=>node('new')},window:{addEventListener(){},dispatchEvent(){}},Event:class{},P:{CHAIN:4663,CONTRACTS:{manager:'0x3333333333333333333333333333333333333333'},MANAGER:[]},...ethers,JsonRpcProvider:class{},Contract:class{}};
 vm.createContext(ctx);
 let source=fs.readFileSync(path.join(__dirname,'app.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace('renderActivity();loadPool();','renderActivity();');
 source+='\nglobalThis.testLP={send,signerFor,execute,loadPool,observeEarlyLogo:fn=>{showSelectedToken=fn;verifyContracts=()=>new Promise(()=>{});metadata=()=>new Promise(()=>{});},loadWalletTokens,resetTokens,tokenRows:()=>walletTokens,set:(a,w,p,s)=>{account=a;wallet=w;injected=p;session=s;},proposal:p=>{proposal=p;},transactions:()=>pending};';
 vm.runInContext(source,ctx);ctx.testLP.set(who,{getSigner:async()=>signer},provider,1);
 return {api:ctx.testLP,signer,hash,store,nodes,mockFetch:f=>{ctx.fetch=f;},sendCount:()=>sendCount,captured:()=>captured,chain:v=>chain=v,accounts:v=>accounts=v,failCall:()=>callFail=true,failEstimate:()=>estimateFail=true,revert:()=>revert=true,afterEstimate:f=>afterEstimate=f,afterWait:f=>afterWait=f};
}
(async()=>{
 const request={to:'0x3333333333333333333333333333333333333333',data:'0x1234',value:0n};
 let h=harness();h.chain('0x1');await assert.rejects(h.api.send(h.signer,request,'Deposit',who,1),/Wallet or network changed/);assert.equal(h.sendCount(),0);
 h=harness();h.accounts(['0x4444444444444444444444444444444444444444']);await assert.rejects(h.api.signerFor(who,1),/changed/);
 h=harness();h.failCall();await assert.rejects(h.api.send(h.signer,request,'Deposit',who,1),/preflight/);assert.equal(h.sendCount(),0);
 h=harness();h.failEstimate();await assert.rejects(h.api.send(h.signer,request,'Deposit',who,1),/estimate/);assert.equal(h.sendCount(),0);
 h=harness();h.afterEstimate(()=>h.chain('0x1'));await assert.rejects(h.api.send(h.signer,request,'Deposit',who,1),/changed/);assert.equal(h.sendCount(),0);
 h=harness();h.revert();await assert.rejects(h.api.send(h.signer,request,'Deposit',who,1));assert.equal(h.api.transactions()[0].status,'Reverted');
 h=harness();await h.api.send(h.signer,request,'Deposit',who,1);assert.equal(h.captured().chainId,4663);assert.equal(h.captured().gasLimit,120n);assert.equal(h.api.transactions()[0].status,'Confirmed');
 h=harness();h.afterWait(()=>h.api.set('0x4444444444444444444444444444444444444444',null,null,2));await assert.rejects(h.api.send(h.signer,request,'Deposit',who,1),/changed/);assert.equal(h.api.transactions()[0].account,who.toLowerCase());assert.equal(h.api.transactions()[0].status,'Confirmed');
 h=harness();h.api.proposal({createdAt:Date.now()-400000,who,epoch:1});await h.api.execute();assert.match(h.nodes.get('notice').textContent,/expired/);assert.equal(h.sendCount(),0);
 h=harness();let resolveOld;h.mockFetch(()=>new Promise(resolve=>{resolveOld=resolve;}));const waiting=h.api.loadWalletTokens();await new Promise(resolve=>setImmediate(resolve));h.api.set('0x4444444444444444444444444444444444444444',null,null,2);h.api.resetTokens();resolveOld({ok:true,json:async()=>({tokens:[]})});await waiting;assert.equal(h.api.tokenRows().length,0);assert.match(h.nodes.get('walletTokenStatus').textContent,/Connect your wallet/);
 h=harness();let resolveFirst,calls=0;h.mockFetch(()=>++calls===1?new Promise(resolve=>{resolveFirst=resolve;}):Promise.resolve({ok:true,json:async()=>({tokens:[]})}));const first=h.api.loadWalletTokens();await new Promise(resolve=>setImmediate(resolve));await h.api.loadWalletTokens();resolveFirst({ok:true,json:async()=>({tokens:[]})});await first;assert.match(h.nodes.get('walletTokenStatus').textContent,/0 wallet tokens/);
 h=harness();let earlyToken=null;h.nodes.get('tokenAddress').value=who;h.api.observeEarlyLogo(token=>{earlyToken=token;});h.api.loadPool();assert.equal(earlyToken.address,who.toLowerCase());
 console.log('PASS: wallet/network changes, preflight and gas failures, receipt reverts, explicit chain ID, confirmed status, session changes after confirmation, and expired review. No transactions submitted.');
})().catch(e=>{console.error(e);process.exitCode=1});
