const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict'),esbuild=require('esbuild');
const {Interface}=require('ethers'),folder=fs.mkdtempSync(path.join(os.tmpdir(),'rwi-curve-controller-'));
(async()=>{
 const factory='0x'+'1'.repeat(40),router='0x'+'2'.repeat(40),hook='0x'+'3'.repeat(40),token='0x'+'4'.repeat(40),who='0x'+'5'.repeat(40);
 const build=JSON.parse(fs.readFileSync(path.join(__dirname,'../../assets/launch-v2-contract.json'))),fi=new Interface(build.factory.abi),ri=new Interface(build.router.abi);
 const source=fs.readFileSync(path.join(__dirname,'launch-client.js'),'utf8').replace(/import \{ LAUNCH_V2_FACTORY as LAUNCH_FACTORY \} from '[^']+';/,`const LAUNCH_FACTORY='${factory}';`);
 const file=path.join(folder,'client.cjs');esbuild.buildSync({stdin:{contents:source,resolveDir:__dirname},outfile:file,bundle:true,platform:'node',format:'cjs'});
 const {createLaunchController}=require(file),nodes=new Map();
 const get=id=>{if(!nodes.has(id))nodes.set(id,{value:'',hidden:false,disabled:false,open:false,classList:{toggle(){}},events:{},addEventListener(n,fn){this.events[n]=fn},removeAttribute(n){delete this[n]},querySelectorAll(){return []},close(){this.open=false},showModal(){this.open=true}});return nodes.get(id)};
 global.document={getElementById:get,querySelectorAll:()=>[]};let phase=0n,rewards=10n**18n,badCode=false;
 const rpc={async getCode(address){return badCode?'0x00':address.toLowerCase()===factory?build.factory.deployedBytecode:address.toLowerCase()===router?build.router.deployedBytecode:build.hook.deployedBytecode},async call(tx){const isRouter=tx.to.toLowerCase()===router,iface=isRouter?ri:fi,p=iface.parseTransaction(tx);let answer;
   if(p.name==='hook')answer=[hook];else if(p.name==='router')answer=[router];else if(p.name==='factory')answer=[factory];else if(p.name==='rewardRwi')answer=[rewards];else if(p.name==='claimRewards')answer=[10n**12n];else if(p.name==='launches')answer=[who,0,'0x'+'0'.repeat(64),10n**20n,0,10n**27n,10n**27n*2n/7n,200,phase,1793300000];else throw Error('Unexpected call '+p.name);return iface.encodeFunctionResult(p.name,answer);
 }};
 let price='0.00002665263821';const oldFetch=global.fetch;global.fetch=async()=>({ok:true,json:async()=>({chainId:4663,prices:{'0xda2598c976e62e7e15dcca75169b404712e48b04':price},quotedAt:{'0xda2598c976e62e7e15dcca75169b404712e48b04':Date.now()}})});
 try{
  get('launchName').value='Controller test';get('launchSymbol').value='TEST';get('launchCreatorTax').value='200';
  const ui=createLaunchController({rpc,isBusy:()=>false,getSession:()=>({who,epoch:1}),getSigner:async()=>null,onFormChange(){}}),review=await ui.prepare(who,1);
  assert.equal(review.tax,200);assert.equal(review.terms.targetMarketCapUsd,'5000');let request=await ui.request(review),decoded=fi.parseTransaction(request);assert.equal(decoded.name,'launch');assert.equal(decoded.args.tax,200n);assert.equal(decoded.args.phantomQuote,BigInt(review.terms.phantomQuote));assert.equal(request.value,0n);
  price='0.00003';await assert.rejects(ui.request(review),/changed/);price='0.00002665263821';
  get('launchCreatorTax').value='999';await assert.rejects(ui.prepare(who,1),/Choose/);get('launchCreatorTax').value='0';
  const claim=await ui.feeReview(token,who,1);assert.equal(claim.minimum,995000000000n);request=await ui.request(claim);decoded=fi.parseTransaction(request);assert.equal(decoded.name,'claimRewards');assert.equal(decoded.args.minEth,claim.minimum);
  await assert.rejects(ui.feeReview(token,token,1),/creator wallet/);rewards=0n;await assert.rejects(ui.feeReview(token,who,1),/No creator rewards/);rewards=10n**18n;
  await assert.rejects(ui.graduationReview(token,who,1),/not waiting/);phase=1n;const grad=await ui.graduationReview(token,who,1);assert.equal(fi.parseTransaction(await ui.request(grad)).name,'graduate');
  const buy={kind:'launchbuy',token,router,amount:10n**14n,rwiWanted:10n**20n,minimum:10n**21n,quotedAt:Date.now()};decoded=ri.parseTransaction(await ui.request(buy));assert.equal(decoded.name,'buy');assert.equal(decoded.args.rwiWanted,buy.rwiWanted);assert.equal(decoded.args.minimum,buy.minimum);
  await assert.rejects(ui.request({...buy,quotedAt:Date.now()-120001}),/expired/);badCode=true;await assert.rejects(ui.request(buy),/could not be verified/);
 }finally{global.fetch=oldFetch;delete global.document;}
 console.log('PASS: prepared $5,000/creator-tax calldata, fresh-review gate, ETH reward minimums, creator ownership, graduation retry, RWI-capped buys, quote expiry and deployed-code verification.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{for(const n of fs.readdirSync(folder))fs.unlinkSync(path.join(folder,n));fs.rmdirSync(folder)});
