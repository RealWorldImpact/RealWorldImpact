const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict'),esbuild=require('esbuild');
const {Interface,keccak256,parseEther}=require('ethers');
const {terms}=require('../../contracts/launch-v4/economics-model.cjs');
const {expectedRuntime}=require('../../contracts/launch-v4/verify-deployment.cjs');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'rwi-v4-controller-'));
(async()=>{
 const factory='0x'+'1'.repeat(40),router='0x'+'2'.repeat(40),hook='0x'+'3'.repeat(40),token='0x'+'4'.repeat(40),who='0x'+'5'.repeat(40),oracle='0x'+'6'.repeat(40);
 const build=JSON.parse(fs.readFileSync(path.join(__dirname,'../../assets/launch-v4-contract.json'))),fi=new Interface(build.factory.abi),ri=new Interface(build.router.abi),runtime=expectedRuntime(build.factory,oracle);
 const file=path.join(folder,'client.cjs');await esbuild.build({entryPoints:[path.join(__dirname,'launch-client.js')],outfile:file,bundle:true,platform:'node',format:'cjs',plugins:[{name:'test-config',setup(b){b.onLoad({filter:/launch-v4-config\.js$/},()=>({contents:`export const LAUNCH_V4_FACTORY='${factory}',LAUNCH_V4_ORACLE='${oracle}',LAUNCH_V4_RUNTIME_HASH='${keccak256(runtime)}';`,loader:'js'}));}}]});
 const {createLaunchController}=require(file),nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,{value:'',hidden:false,disabled:false,open:false,classList:{toggle(){}},events:{},addEventListener(n,f){this.events[n]=f},removeAttribute(n){delete this[n]},querySelectorAll(){return []},close(){this.open=false},showModal(){this.open=true}});return nodes.get(id)};
 global.document={getElementById:get,querySelectorAll:()=>[]};global.location={search:''};
 let phase=0n,rewards=10n**18n,badCode=false,badOracle=false,eligible=false,delayComplete=false,readySince=0n,price=parseEther('0.00003'),stale=false;
 const now=()=>BigInt(Math.floor(Date.now()/1000));
 const rpc={getBlockNumber:async()=>100,getCode:async address=>badCode?'0x00':address.toLowerCase()===factory?runtime:address.toLowerCase()===router?build.router.deployedBytecode:build.hook.deployedBytecode,
 async call(tx){const isRouter=tx.to.toLowerCase()===router,iface=isRouter?ri:fi,p=iface.parseTransaction(tx);let answer;const t=terms(price);
  if(p.name==='previewTerms')answer=[t.phantom,t.inventory,price];else if(p.name==='readOracle')answer=[[price,price,price,now()-(stale?301n:0n),1800]];
  else if(p.name==='hook')answer=[hook];else if(p.name==='router')answer=[router];else if(p.name==='oracle')answer=[badOracle?who:oracle];else if(p.name==='factory')answer=[factory];
  else if(p.name==='rewardRwi')answer=[rewards];else if(p.name==='claimRewards')answer=[10n**12n];
  else if(p.name==='graduationStatus')answer=[40000n*10n**18n,250001n*10n**16n,eligible,delayComplete];
  else if(p.name==='launches')answer=[who,0,'0x'+'0'.repeat(64),t.phantom,0,t.inventory,t.inventory,price,0,0,now(),readySince,0,200,phase];
  else throw Error('Unexpected call '+p.name);return iface.encodeFunctionResult(p.name,answer);
 }};
 try{
  get('launchName').value='Controller test';get('launchSymbol').value='TEST';get('launchCreatorTax').value='200';
  const ui=createLaunchController({rpc,isBusy:()=>false,getSession:()=>({who,epoch:1}),getSigner:async()=>null,onFormChange(){}}),review=await ui.prepare(who,1);
  assert.equal(review.terms.graduationTargetUsd,'40000');assert.equal(review.tax,200);assert(review.rows.some(r=>r[0]==='RWI fundraising target'&&r[1]==='None'));assert(!review.rows.some(r=>/ceiling/.test(r[0])));
  let request=await ui.request(review),decoded=fi.parseTransaction(request);assert.equal(decoded.name,'launch');assert.equal(decoded.args.tax,200n);assert.equal(decoded.args.minRwiUsd,BigInt(review.terms.minRwiUsd));assert.equal(decoded.args.maxRwiUsd,BigInt(review.terms.maxRwiUsd));assert.equal(request.value,0n);
  price=parseEther('0.000031');await assert.rejects(ui.request(review),/moved outside/);price=parseEther('0.00003');stale=true;await assert.rejects(ui.request(review),/stale/);stale=false;
  await assert.rejects(ui.request({...review,terms:{...review.terms,quotedAt:Date.now()-120001}}),/expired/);
  get('launchCreatorTax').value='999';await assert.rejects(ui.prepare(who,1),/Choose/);get('launchCreatorTax').value='0';
  const claim=await ui.feeReview(token,who,1);assert.equal(claim.minimum,995000000000n);decoded=fi.parseTransaction(await ui.request(claim));assert.equal(decoded.name,'claimRewards');assert.equal(decoded.args.minEth,claim.minimum);
  await assert.rejects(ui.feeReview(token,token,1),/creator wallet/);rewards=0n;await assert.rejects(ui.feeReview(token,who,1),/No creator rewards/);rewards=10n**18n;
  await assert.rejects(ui.graduationReview(token,who,1),/Both/);eligible=true;const checkpoint=await ui.graduationReview(token,who,1);assert.equal(fi.parseTransaction(await ui.request(checkpoint)).name,'checkpoint');
  readySince=now();await assert.rejects(ui.graduationReview(token,who,1),/five-minute/);delayComplete=true;const grad=await ui.graduationReview(token,who,1);assert.equal(fi.parseTransaction(await ui.request(grad)).name,'graduate');phase=2n;await assert.rejects(ui.graduationReview(token,who,1),/already graduated/);
  const buy={kind:'launchbuy',token,router,amount:10n**14n,rwiWanted:10n**20n,minimum:10n**21n,quotedAt:Date.now()};decoded=ri.parseTransaction(await ui.request(buy));assert.equal(decoded.name,'buy');assert.equal(decoded.args.rwiWanted,buy.rwiWanted);assert.equal(decoded.args.minimum,buy.minimum);
  await assert.rejects(ui.request({...buy,quotedAt:Date.now()-120001}),/expired/);badOracle=true;await assert.rejects(ui.request(buy),/price service/);badOracle=false;badCode=true;await assert.rejects(ui.request(buy),/could not be verified/);
 }finally{delete global.document;delete global.location;}
 console.log('PASS: V4 launch calldata, $40k/liquidity terms, price bounds and expiry, oracle/code verification, ETH claims, checkpoint and delayed graduation.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{for(const n of fs.readdirSync(folder))fs.unlinkSync(path.join(folder,n));fs.rmdirSync(folder)});
