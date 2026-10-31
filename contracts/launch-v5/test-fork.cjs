const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {JsonRpcProvider,Contract,ContractFactory,ZeroAddress,MaxUint256,parseEther,hexlify,randomBytes,getCreate2Address,getCreateAddress,keccak256,toBeHex,concat,AbiCoder}=require('../launch/node_modules/ethers');
const artifact=n=>JSON.parse(fs.readFileSync(path.join(__dirname,'artifacts',n+'.json')));
const json=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v,2);
const W=10n**18n,S=10n**27n,ETH_FEED='0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9';
(async()=>{
 const rpc=new JsonRpcProvider('http://127.0.0.1:8903',4663,{staticNetwork:true,cacheTimeout:-1});rpc.pollingInterval=40;
 try{
 let metadata=await rpc.send('hardhat_metadata',[]);assert.equal(metadata.chainId,4663);assert(metadata.forkedNetwork);
 await rpc.send('hardhat_reset',[{forking:{jsonRpcUrl:'https://rpc.mainnet.chain.robinhood.com'}}]);metadata=await rpc.send('hardhat_metadata',[]);await rpc.send('evm_mine',[]);
 const creator=await rpc.getSigner(0),trader=await rpc.getSigner(3),who=await creator.getAddress(),buyer=await trader.getAddress();
 const deploy=async(name,args=[],signer=creator)=>{const a=artifact(name),c=await new ContractFactory(a.abi,a.bytecode,signer).deploy(...args);await c.waitForDeployment();return c;};
 const now=async()=>Number((await rpc.getBlock('latest')).timestamp),deadline=async()=>await now()+120;
 const predicted=getCreateAddress({from:who,nonce:await rpc.getTransactionCount(who)}),hookHash=artifact('RWICreatorHookV5').creationHash;
 let salt=0n,hookAddress;do{hookAddress=getCreate2Address(predicted,toBeHex(salt++,32),hookHash);}while((BigInt(hookAddress)&0x3fffn)!==0x20ccn);
 const factory=await deploy('RWILaunchV5',[toBeHex(salt-1n,32)]),address=await factory.getAddress();assert.equal(address,predicted);
 const hook=new Contract(await factory.hook(),artifact('RWICreatorHookV5').abi,creator),router=new Contract(await factory.router(),artifact('RWILaunchRouterV5').abi,trader),routerAddress=await router.getAddress();
 const rwiAddress=await factory.RWI(),rwi=new Contract(rwiAddress,['function balanceOf(address) view returns(uint256)','function approve(address,uint256) returns(bool)','function allowance(address,address) view returns(uint256)','function transfer(address,uint256) returns(bool)'],trader);
 const pmAddress=await factory.POSITION_MANAGER(),pm=new Contract(pmAddress,['function ownerOf(uint256) view returns(address)','function getPositionLiquidity(uint256) view returns(uint128)'],rpc);
 const quoter=new Contract('0x8dc178efb8111bb0973dd9d722ebeff267c98f94',['function quoteExactInput((address exactCurrency,(address intermediateCurrency,uint24 fee,int24 tickSpacing,address hooks,bytes hookData)[] path,uint128 exactAmount) params) returns(uint256 amountOut,uint256 gasEstimate)'],rpc);
 const rwiHop={intermediateCurrency:rwiAddress,fee:0,tickSpacing:200,hooks:await router.RWI_HOOK(),hookData:'0x'},ethHop={...rwiHop,intermediateCurrency:ZeroAddress};
 const quote=async(currency,hops,amount)=>(await quoter.quoteExactInput.staticCall({exactCurrency:currency,path:hops,exactAmount:amount}))[0];
 const m={name:'Local V5 Research',symbol:'TEST',logo:'',description:'Local only',website:'',twitter:'',telegram:''};
 const create=async(tax,token0)=>{
  const hash=keccak256(concat([artifact('RWICurveTokenV5').bytecode,AbiCoder.defaultAbiCoder().encode(['string','string','string','string','string','string','string','address'],[m.name,m.symbol,m.logo,m.description,m.website,m.twitter,m.telegram,who])]));
  let tokenSalt,tokenAddress;do{tokenSalt=hexlify(randomBytes(32));tokenAddress=getCreate2Address(address,keccak256(AbiCoder.defaultAbiCoder().encode(['address','bytes32'],[who,tokenSalt])),hash);}while(token0!==undefined&&(BigInt(tokenAddress)<BigInt(rwiAddress))!==token0);
  const p=(await factory.openingQuote()).referenceUsd;await(await factory.launch(m,p,p,tax,tokenSalt,await deadline())).wait();return new Contract(tokenAddress,artifact('RWICurveTokenV5').abi,trader);
 };
 const buy=async(token,gross,value=parseEther('10'))=>{const [out,spent]=await factory.quoteBuy(token,gross);const receipt=await(await router.buy(token,gross,out,await deadline(),{value,gasLimit:5000000})).wait();return {out,spent,receipt};};
 const sell=async(token,amount)=>{const t=new Contract(token,artifact('RWICurveTokenV5').abi,trader);await(await t.approve(routerAddress,amount)).wait();const [r]=await factory.quoteSell(token,amount),eth=await quote(rwiAddress,[ethHop],r);await(await router.sell(token,amount,eth,await deadline(),{gasLimit:1500000})).wait();};
 const finish=token=>buy(token,parseEther('1000000000'));
 let root=await rpc.send('evm_snapshot',[]);const restore=async()=>{await rpc.send('evm_revert',[root]);root=await rpc.send('evm_snapshot',[]);};
 const cases=[];
 for(const tax of [0,100,200,300])for(const token0 of [false,true]){
  await restore();const t=await create(tax,token0),token=await t.getAddress();let l=await factory.launches(token);
  const opening=l.openingRwiUsd;assert.equal(await t.totalSupply(),S);assert.equal(await t.balanceOf(who),0n);assert.equal(await rwi.balanceOf(who),0n);
  const terms=await factory.previewTerms();assert.equal(terms.reserved,l.reservedTokens);assert.equal(terms.phantom,l.phantomQuote);
  assert((l.phantomQuote*S/l.initialTokens)*opening/W>=5000n*W);assert.equal((await factory.curveProgress(token)).sold,0n);await assert.rejects(factory.graduate.staticCall(token));
  if(tax===0&&!token0){
   for(const bad of [1,99,101,400,10000])await assert.rejects(factory.launch.staticCall(m,opening,opening,bad,hexlify(randomBytes(32)),await deadline()));
   await assert.rejects(factory.launch.staticCall(m,opening+1n,opening+2n,0,hexlify(randomBytes(32)),await deadline()));
   const manager=new Contract(await factory.POOL_MANAGER(),['function initialize((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks),uint160) returns(int24)'],trader);
   await assert.rejects(manager.initialize.staticCall(Array.from(await factory.keyFor(token)),2n**96n));
  }
  const first=await buy(token,1000n*W);l=await factory.launches(token);assert.equal(l.quoteReserve,first.spent-first.spent*(100n+BigInt(tax))/10000n);
  const before=Array.from(l);await assert.rejects(router.buy.staticCall(token,1000n*W,S,await deadline(),{value:parseEther('1')}));assert.deepEqual(Array.from(await factory.launches(token)),before);
  await assert.rejects(factory.connect(trader).claimRewards.staticCall(token,1n,await deadline()));await sell(token,first.out/3n);
  const claim=await factory.claimRewards.staticCall(token,1n,await deadline());await(await factory.claimRewards(token,claim,await deadline())).wait();assert.equal(await factory.rewardRwi(token),0n);
  if(tax===0&&!token0){
   // Loss of the creation-price component cannot strand ANY existing launch operation.
   await rpc.send('hardhat_setCode',[ETH_FEED,'0x60006000fd']);await assert.rejects(factory.previewTerms());await assert.rejects(factory.launch.staticCall(m,opening,opening,0,hexlify(randomBytes(32)),await deadline()));
   await buy(token,1000n*W);await sell(token,(await t.balanceOf(buyer))/10n);
   // Automatic graduation rolls back its own changes and leaves curve redemption open.
   const code=await rpc.getCode(pmAddress);await rpc.send('hardhat_setCode',[pmAddress,'0x60006000fd']);
   await finish(token);const failed=await factory.launches(token);assert.equal(failed.phase,0n);assert.equal(failed.tokenReserve,failed.reservedTokens);assert((await factory.curveProgress(token)).ready);
   const record=Array.from(failed),reserve=await rwi.balanceOf(address);await assert.rejects(async()=>{await(await factory.graduate(token,{gasLimit:3000000})).wait();});assert.deepEqual(Array.from(await factory.launches(token)),record);assert.equal(await rwi.balanceOf(address),reserve);
   await sell(token,(await t.balanceOf(buyer))/100n);assert(!(await factory.curveProgress(token)).ready);
   await rpc.send('hardhat_setCode',[pmAddress,code]);
  }
  const finalBuy=await finish(token);l=await factory.launches(token);assert.equal(l.phase,2n);assert.equal(l.tokenReserve,l.reservedTokens);assert.equal(await pm.ownerOf(l.positionId),address);assert((await pm.getPositionLiquidity(l.positionId))>0n);
  const event=finalBuy.receipt.logs.map(x=>{try{return router.interface.parseLog(x)}catch{return null;}}).find(x=>x?.name==='Trade');assert(event.args.ethRefund>0n,'Oversized final buy must refund ETH');
  const actualUsd=(l.seededQuote+l.seededTokens*(l.phantomQuote+l.quoteReserve)/l.tokenReserve)*opening/W;
  assert(actualUsd>=4999n*W&&actualUsd<=5001n*W);assert(l.seededQuote<=l.quoteReserve);assert.equal((await factory.curveProgress(token)).sold,l.initialTokens-l.reservedTokens);
  assert.equal(await rwi.allowance(address,await factory.PERMIT2()),0n);assert.equal(await t.allowance(address,await factory.PERMIT2()),0n);
  await assert.rejects(factory.graduate.staticCall(token));await assert.rejects(factory.quoteBuy(token,W));await assert.rejects(factory.quoteSell(token,W));
  const tokenHop={intermediateCurrency:token,fee:0,tickSpacing:200,hooks:hookAddress,hookData:'0x'},hookRwi={...tokenHop,intermediateCurrency:rwiAddress},input=10n**12n;
  const out=await quote(ZeroAddress,[rwiHop,tokenHop],input);await(await router.buy(token,0,out,await deadline(),{value:input})).wait();await(await t.approve(routerAddress,out/2n)).wait();const eth=await quote(token,[hookRwi,ethHop],out/2n);await(await router.sell(token,out/2n,eth,await deadline())).wait();assert((await hook.rewards(token))>0n);
  const helper=await deploy('SwapHarness',[],trader),helperAddress=await helper.getAddress(),key=Array.from(await factory.keyFor(token));
  await(await helper.swap({currency0:ZeroAddress,currency1:rwiAddress,fee:0,tickSpacing:200,hooks:await router.RWI_HOOK()},true,-(10n**15n),{value:10n**15n})).wait();await(await rwi.approve(helperAddress,MaxUint256)).wait();
  const desired=10n**21n,balance=await t.balanceOf(buyer);await(await helper.swap(key,!token0,desired)).wait();assert.equal(await t.balanceOf(buyer)-balance,desired);await(await t.approve(helperAddress,MaxUint256)).wait();const rwibefore=await rwi.balanceOf(buyer);await(await helper.swap(key,token0,10n**14n)).wait();assert.equal(await rwi.balanceOf(buyer)-rwibefore,10n**14n);
  const oldHook=await hook.rewards(token),oldCurve=await factory.curveRewards(token),principal=await pm.getPositionLiquidity(l.positionId),locked=await t.balanceOf(address);
  await assert.rejects(async()=>{await(await factory.claimRewards(token,parseEther('100000'),await deadline(),{gasLimit:2000000})).wait();});assert.equal(await hook.rewards(token),oldHook);assert.equal(await factory.curveRewards(token),oldCurve);
  const rewardQuote=await factory.claimRewards.staticCall(token,1n,await deadline());await(await factory.claimRewards(token,rewardQuote,await deadline())).wait();assert.equal(await factory.rewardRwi(token),0n);assert.equal(await pm.getPositionLiquidity(l.positionId),principal);assert.equal(await t.balanceOf(address),locked);
  const record=Array.from(await factory.launches(token));await(await t.transfer(address,1000n)).wait();await(await rwi.transfer(address,1000n)).wait();assert.deepEqual(Array.from(await factory.launches(token)),record);assert.equal(await factory.rewardRwi(token),0n);
  for(const [coin,owner,spender]of [[rwi,routerAddress,address],[t,routerAddress,address],[rwi,address,routerAddress]])assert.equal(await coin.allowance(owner,spender),0n);
  assert.equal(await rwi.balanceOf(routerAddress),0n);assert.equal(await t.balanceOf(routerAddress),0n);assert.equal(await rpc.getBalance(routerAddress),0n);
  cases.push({tax,token0,openingRwiUsd:opening,poolUsdAtOpeningReference:actualUsd,netRwi:l.quoteReserve,position:l.positionId});console.log('PASS',tax,'bps, token0',token0);
 }
 await restore();const one=await create(100,true),two=await create(300,false),oneAddress=await one.getAddress(),twoAddress=await two.getAddress();await buy(oneAddress,2000n*W);await buy(twoAddress,4000n*W);const twoState=Array.from(await factory.launches(twoAddress)),twoRewards=await factory.rewardRwi(twoAddress);await sell(oneAddress,(await one.balanceOf(buyer))/2n);await(await factory.claimRewards(oneAddress,1n,await deadline())).wait();assert.deepEqual(Array.from(await factory.launches(twoAddress)),twoState);assert.equal(await factory.rewardRwi(twoAddress),twoRewards);const liability=(await factory.launches(oneAddress)).quoteReserve+(await factory.launches(twoAddress)).quoteReserve+await factory.rewardRwi(oneAddress)+await factory.rewardRwi(twoAddress);assert.equal(await rwi.balanceOf(address),liability);
 for(const action of [()=>factory.buyCurve.staticCall(oneAddress,W,buyer),()=>factory.sellCurve.staticCall(oneAddress,W,buyer),()=>factory.executeGraduation.staticCall(oneAddress),()=>hook.register.staticCall(oneAddress,0),()=>hook.withdrawRewards.staticCall(oneAddress),()=>hook.unlockCallback.staticCall('0x'),()=>router.unlockCallback.staticCall('0x'),()=>router.convertRewards.staticCall(W,1n,buyer)])await assert.rejects(action);
 await restore();const opening=(await factory.openingQuote()).referenceUsd,probe=await deploy('CreatorProbe',[address]);await(await probe.create(opening,hexlify(randomBytes(32)))).wait();const probeToken=await probe.token();await buy(probeToken,1000n*W);const reward=await factory.rewardRwi(probeToken),state=Array.from(await factory.launches(probeToken));await(await probe.setReject(true)).wait();await assert.rejects(async()=>{await(await probe.claim({gasLimit:2000000})).wait();});assert.equal(await factory.rewardRwi(probeToken),reward);assert.deepEqual(Array.from(await factory.launches(probeToken)),state);await(await probe.setReject(false)).wait();await(await probe.claim()).wait();assert(await probe.attempted());assert.equal(await probe.reentered(),false);assert.equal(await probe.rejection(),keccak256(Buffer.from('ReentrancyGuardReentrantCall()')).slice(0,10));assert.equal(await factory.rewardRwi(probeToken),0n);
 const report={testedAt:new Date().toISOString(),localOnly:true,fork:metadata.forkedNetwork,mainnetTransactions:0,cases,automaticGraduation:true,failedGraduationSellsAndRetry:true,postLaunchPriceFeedIndependence:true,exactOutputSwaps:16,concurrentLaunchIsolation:true,reentrantEthClaimRejected:true,rejectedRecipientRollback:true,donationIsolation:true,implementation:{factoryRuntimeHash:keccak256(await rpc.getCode(address)),factoryCreationHash:artifact('RWILaunchV5').creationHash,hookRuntimeHash:keccak256(await rpc.getCode(hookAddress)),routerRuntimeHash:keccak256(await rpc.getCode(routerAddress))}};
 fs.writeFileSync(path.join(__dirname,'artifacts/fork-validation.json'),json(report));console.log('PASS V5 fork',json(report));
 }finally{rpc.destroy();}
})().catch(e=>{console.error(e);process.exitCode=1});
