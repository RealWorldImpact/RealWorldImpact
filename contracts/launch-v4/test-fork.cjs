const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {JsonRpcProvider,Contract,ContractFactory,ZeroAddress,MaxUint256,parseEther,hexlify,randomBytes,getCreate2Address,getCreateAddress,keccak256,toBeHex,concat,AbiCoder}=require('../launch/node_modules/ethers');
const artifact=n=>JSON.parse(fs.readFileSync(path.join(__dirname,'artifacts',n+'.json')));
const json=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v,2);
const W=10n**18n,S=10n**27n;
(async()=>{
 const rpc=new JsonRpcProvider('http://127.0.0.1:8901',4663,{staticNetwork:true,cacheTimeout:-1});rpc.pollingInterval=40;
 let metadata=await rpc.send('hardhat_metadata',[]);assert.equal(metadata.chainId,4663);await rpc.send('hardhat_reset',[{forking:{jsonRpcUrl:'https://rpc.mainnet.chain.robinhood.com'}}]);metadata=await rpc.send('hardhat_metadata',[]); // Never send test mutations to a production RPC.
 const creator=await rpc.getSigner(0),trader=await rpc.getSigner(3),who=await creator.getAddress(),buyer=await trader.getAddress();
 const deploy=async(name,args=[],signer=creator)=>{const a=artifact(name),c=await new ContractFactory(a.abi,a.bytecode,signer).deploy(...args);await c.waitForDeployment();return c};
 const oracle=await deploy('MockRwiOracle'),oracleAddress=await oracle.getAddress();
 const now=async()=>Number((await rpc.getBlock('latest')).timestamp),deadline=async()=>await now()+120;
 const setPrice=async(price,extra={},mode=0)=>{await(await oracle.set({price,lower:price,upper:price,observedAt:await now(),window:1800,...extra},mode)).wait()};
 const initial=parseEther('0.01');await setPrice(initial);
 const predicted=getCreateAddress({from:who,nonce:await rpc.getTransactionCount(who)}),hookHash=artifact('RWICreatorHookV4').creationHash;
 let salt=0n,hookAddress;do{hookAddress=getCreate2Address(predicted,toBeHex(salt++,32),hookHash)}while((BigInt(hookAddress)&0x3fffn)!==0x20ccn);
 const factory=await deploy('RWILaunchV4',[toBeHex(salt-1n,32),oracleAddress]),address=await factory.getAddress();assert.equal(address,predicted);
 const hook=new Contract(await factory.hook(),artifact('RWICreatorHookV4').abi,creator),router=new Contract(await factory.router(),artifact('RWILaunchRouterV4').abi,trader),routerAddress=await router.getAddress();
 const rwiAddress=await factory.RWI(),rwi=new Contract(rwiAddress,['function balanceOf(address) view returns(uint256)','function approve(address,uint256) returns(bool)','function allowance(address,address) view returns(uint256)','function transfer(address,uint256) returns(bool)'],trader);
 const pmAddress=await factory.POSITION_MANAGER(),pm=new Contract(pmAddress,['function ownerOf(uint256) view returns(address)','function getPositionLiquidity(uint256) view returns(uint128)'],rpc);
 const quoter=new Contract('0x8dc178efb8111bb0973dd9d722ebeff267c98f94',['function quoteExactInput((address exactCurrency,(address intermediateCurrency,uint24 fee,int24 tickSpacing,address hooks,bytes hookData)[] path,uint128 exactAmount) params) returns(uint256 amountOut,uint256 gasEstimate)'],rpc);
 const rwiHop={intermediateCurrency:rwiAddress,fee:0,tickSpacing:200,hooks:await router.RWI_HOOK(),hookData:'0x'},ethHop={...rwiHop,intermediateCurrency:ZeroAddress};
 const quote=async(currency,hops,amount)=>(await quoter.quoteExactInput.staticCall({exactCurrency:currency,path:hops,exactAmount:amount}))[0];
 const m={name:'Local V4 Research',symbol:'TEST',logo:'',description:'Local tests; never deployed',website:'',twitter:'',telegram:''};
 const create=async(tax,token0)=>{
  const hash=keccak256(concat([artifact('RWICurveTokenV4').bytecode,AbiCoder.defaultAbiCoder().encode(['string','string','string','string','string','string','string','address'],[m.name,m.symbol,m.logo,m.description,m.website,m.twitter,m.telegram,who])]));
  let tokenSalt,tokenAddress;do{tokenSalt=hexlify(randomBytes(32));tokenAddress=getCreate2Address(address,keccak256(AbiCoder.defaultAbiCoder().encode(['address','bytes32'],[who,tokenSalt])),hash)}while(token0!==undefined&&(BigInt(tokenAddress)<BigInt(rwiAddress))!==token0);
  const p=(await factory.readOracle()).price;await(await factory.launch(m,p,p,tax,tokenSalt,await deadline())).wait();return new Contract(tokenAddress,artifact('RWICurveTokenV4').abi,trader);
 };
 const buy=async(token,gross,value=parseEther('10'))=>{const [out,spent]=await factory.quoteBuy(token,gross);const receipt=await(await router.buy(token,gross,out,await deadline(),{value,gasLimit:2500000})).wait();return {out,spent,receipt}};
 const sell=async(token,amount)=>{const t=new Contract(token,artifact('RWICurveTokenV4').abi,trader);await(await t.approve(routerAddress,amount)).wait();const [r]=await factory.quoteSell(token,amount),eth=await quote(rwiAddress,[ethHop],r);await(await router.sell(token,amount,eth,await deadline(),{gasLimit:1000000})).wait()};
 const eligibleFill=token=>buy(token,parseEther('1000000000'));
 let root=await rpc.send('evm_snapshot',[]);const restore=async()=>{await rpc.send('evm_revert',[root]);root=await rpc.send('evm_snapshot',[])};
 const cases=[];let oracleFailures=0;
 for(const tax of [0,100,200,300])for(const token0 of [false,true]){
  await restore();await setPrice(initial);const t=await create(tax,token0),token=await t.getAddress();
  let l=await factory.launches(token);assert.equal(await t.totalSupply(),S);assert.equal(await t.balanceOf(who),0n);assert.equal(await rwi.balanceOf(who),0n);
  const fdv=(await factory.graduationStatus(token)).fdvUsd;assert(fdv>=5000n*W&&fdv<5000n*W+1000n);
  if(tax===0&&!token0){
   for(const invalidTax of [1,99,101,400,10000])await assert.rejects(factory.launch.staticCall(m,initial,initial,invalidTax,hexlify(randomBytes(32)),await deadline()));
   await assert.rejects(factory.launch.staticCall(m,initial+1n,initial+2n,0,hexlify(randomBytes(32)),await deadline()));
   await assert.rejects(factory.launch.staticCall({...m,name:''},initial,initial,0,hexlify(randomBytes(32)),await deadline()));
   await assert.rejects(factory.launch.staticCall(m,initial,initial,0,hexlify(randomBytes(32)),0));
   const poolManager=new Contract(await factory.POOL_MANAGER(),['function initialize((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks),uint160) returns(int24)'],trader);
   await assert.rejects(poolManager.initialize.staticCall(Array.from(await factory.keyFor(token)),2n**96n));
  }
  const first=await buy(token,1000n*W);l=await factory.launches(token);assert.equal(l.quoteReserve,first.spent-first.spent*(100n+BigInt(tax))/10000n);
  const before=Array.from(l),rewards=await factory.rewardRwi(token);await assert.rejects(router.buy.staticCall(token,1000n*W,S,await deadline(),{value:parseEther('1')}));assert.deepEqual(Array.from(await factory.launches(token)),before);
  await assert.rejects(factory.connect(trader).claimRewards.staticCall(token,1n,await deadline()));
  await assert.rejects(factory.claimRewards.staticCall(token,parseEther('100000'),await deadline()));assert.equal(await factory.rewardRwi(token),rewards);
  const claim=await factory.claimRewards.staticCall(token,1n,await deadline());await(await factory.claimRewards(token,claim,await deadline())).wait();assert.equal(await factory.rewardRwi(token),0n);assert.deepEqual(Array.from(await factory.launches(token)),before);
  await sell(token,first.out/3n);
  if(tax===0&&!token0){
   let snap=await rpc.send('evm_snapshot',[]);
   const invalid=[{observedAt:0},{observedAt:await now()-301},{observedAt:await now()+10000},{window:0},{lower:0n},{upper:initial/2n},{upper:initial*103n/100n},{lower:initial*2n},{mode:1},{mode:2}];
   for(const item of invalid){await rpc.send('evm_revert',[snap]);snap=await rpc.send('evm_snapshot',[]);const {mode=0,...fields}=item;await setPrice(initial,fields,mode);await assert.rejects(factory.quoteBuy(token,100n*W));await assert.rejects(factory.previewTerms());await assert.rejects(factory.graduate.staticCall(token));await sell(token,(await t.balanceOf(buyer))/10n);oracleFailures++;}
   await rpc.send('evm_revert',[snap]);await setPrice(initial);
  }
  if(tax===0&&!token0){
   await setPrice(10n**9n);await assert.rejects(factory.quoteBuy(token,W));await assert.rejects(factory.launch.staticCall(m,10n**9n,10n**9n,0,hexlify(randomBytes(32)),await deadline()));await sell(token,(await t.balanceOf(buyer))/100n);await setPrice(initial);
  }
  await eligibleFill(token);l=await factory.launches(token);let status=await factory.graduationStatus(token);assert(status.eligible);assert(status.fdvUsd>=40000n*W&&status.fdvUsd<40000n*W+10n**12n);assert(!status.delayComplete);assert.equal(l.phase,0n);assert(l.quoteReserve*initial/W>=parseEther('2500.01'));
  await assert.rejects(factory.quoteBuy(token,W));await assert.rejects(factory.graduate.staticCall(token));assert((await factory.quoteSell(token,(await t.balanceOf(buyer))/10n))[0]>0n);
  // Selling below the threshold cancels readiness; fresh net buying must qualify again.
  await sell(token,(await t.balanceOf(buyer))/100n);assert.equal((await factory.launches(token)).readySince,0n);await eligibleFill(token);
  await rpc.send('evm_increaseTime',[301]);await rpc.send('evm_mine',[]);await assert.rejects(factory.graduate.staticCall(token)); // stale source cannot complete the delay.
  if(tax===0&&!token0){
   // A report generated just after eligibility is still insufficient after the delay.
   const queued=await factory.launches(token);await setPrice(initial,{observedAt:Number(queued.readySince)+3});await assert.rejects(factory.graduate.staticCall(token));
  }
  await setPrice(initial);
  if(tax===0&&!token0){
   // Current price, not stored launch price, must pass BOTH checks at execution.
   await setPrice(initial/2n);await assert.rejects(factory.graduate.staticCall(token));await(await factory.checkpoint(token)).wait();assert.equal((await factory.launches(token)).readySince,0n);
   await setPrice(initial);await(await factory.checkpoint(token)).wait();await rpc.send('evm_increaseTime',[301]);await rpc.send('evm_mine',[]);await setPrice(initial);
   const code=await rpc.getCode(pmAddress);await rpc.send('hardhat_setCode',[pmAddress,'0x60006000fd']);
   const record=Array.from(await factory.launches(token)),reserve=await rwi.balanceOf(address),reward=await factory.rewardRwi(token);
   await assert.rejects(async()=>{await(await factory.connect(trader).graduate(token,{gasLimit:2500000})).wait()});
   assert.deepEqual(Array.from(await factory.launches(token)),record);assert.equal(await rwi.balanceOf(address),reserve);assert.equal(await factory.rewardRwi(token),reward);
   await sell(token,(await t.balanceOf(buyer))/100n); // Actual sell succeeds while the PositionManager is broken.
   await rpc.send('hardhat_setCode',[pmAddress,code]);await eligibleFill(token);await rpc.send('evm_increaseTime',[301]);await rpc.send('evm_mine',[]);await setPrice(initial);
  }
  const beforeGraduate=await factory.launches(token);await(await factory.connect(trader).graduate(token,{gasLimit:3000000})).wait();l=await factory.launches(token);assert.equal(l.phase,2n);assert.equal(await pm.ownerOf(l.positionId),address);assert((await pm.getPositionLiquidity(l.positionId))>0n);
  const actualUsd=(l.seededQuote+l.seededTokens*(l.phantomQuote+l.quoteReserve)/l.tokenReserve)*initial/W;assert(actualUsd>=5000n*W);assert(l.seededQuote<=l.quoteReserve);
  assert.equal(await rwi.allowance(address,await factory.PERMIT2()),0n);assert.equal(await t.allowance(address,await factory.PERMIT2()),0n);await assert.rejects(factory.graduate.staticCall(token));
  await assert.rejects(factory.quoteBuy(token,W));await assert.rejects(factory.quoteSell(token,W));
  const tokenHop={intermediateCurrency:token,fee:0,tickSpacing:200,hooks:hookAddress,hookData:'0x'},hookRwi={...tokenHop,intermediateCurrency:rwiAddress},input=10n**12n;
  const out=await quote(ZeroAddress,[rwiHop,tokenHop],input);await(await router.buy(token,0,out,await deadline(),{value:input})).wait();await(await t.approve(routerAddress,out/2n)).wait();const eth=await quote(token,[hookRwi,ethHop],out/2n);await(await router.sell(token,out/2n,eth,await deadline())).wait();assert((await hook.rewards(token))>0n);
  // All four v4 swap modes: the two exact-output paths complement the exact-input router paths.
  const helper=await deploy('SwapHarness',[],trader),helperAddress=await helper.getAddress(),key=Array.from(await factory.keyFor(token));
  await(await helper.swap({currency0:ZeroAddress,currency1:rwiAddress,fee:0,tickSpacing:200,hooks:await router.RWI_HOOK()},true,-(10n**15n),{value:10n**15n})).wait();await(await rwi.approve(helperAddress,MaxUint256)).wait();
  const desired=10n**21n,balance=await t.balanceOf(buyer);await(await helper.swap(key,!token0,desired)).wait();assert.equal(await t.balanceOf(buyer)-balance,desired);await(await t.approve(helperAddress,MaxUint256)).wait();const rwibefore=await rwi.balanceOf(buyer);await(await helper.swap(key,token0,10n**14n)).wait();assert.equal(await rwi.balanceOf(buyer)-rwibefore,10n**14n);
  const oldHook=await hook.rewards(token),oldCurve=await factory.curveRewards(token),principal=await pm.getPositionLiquidity(l.positionId),locked=await t.balanceOf(address);
  await assert.rejects(async()=>{await(await factory.claimRewards(token,parseEther('100000'),await deadline(),{gasLimit:2000000})).wait()});assert.equal(await hook.rewards(token),oldHook);assert.equal(await factory.curveRewards(token),oldCurve);
  const rewardQuote=await factory.claimRewards.staticCall(token,1n,await deadline());await(await factory.claimRewards(token,rewardQuote,await deadline())).wait();assert.equal(await factory.rewardRwi(token),0n);assert.equal(await pm.getPositionLiquidity(l.positionId),principal);assert.equal(await t.balanceOf(address),locked);
  const record=Array.from(await factory.launches(token));await(await t.transfer(address,1000n)).wait();await(await rwi.transfer(address,1000n)).wait();assert.deepEqual(Array.from(await factory.launches(token)),record);assert.equal(await factory.rewardRwi(token),0n);
  for(const [coin,owner,spender]of [[rwi,routerAddress,address],[t,routerAddress,address],[rwi,address,routerAddress]])assert.equal(await coin.allowance(owner,spender),0n);
  assert.equal(await rwi.balanceOf(routerAddress),0n);assert.equal(await t.balanceOf(routerAddress),0n);assert.equal(await rpc.getBalance(routerAddress),0n);
  cases.push({tax,token0,actualPoolUsd:actualUsd,readyReserve:beforeGraduate.quoteReserve,position:l.positionId});console.log('PASS',tax,'bps, token0',token0,'actual USD',Number(actualUsd)/1e18);
 }
 await restore();await setPrice(initial);const early=await create(0,true),earlyAddress=await early.getAddress();await setPrice(initial*100n);assert.equal((await factory.graduationStatus(earlyAddress)).eligible,false);await(await factory.checkpoint(earlyAddress)).wait();assert.equal((await factory.launches(earlyAddress)).readySince,0n);await assert.rejects(factory.graduate.staticCall(earlyAddress));
 await eligibleFill(earlyAddress);assert((await factory.launches(earlyAddress)).quoteReserve<parseEther('2501'));assert((await factory.graduationStatus(earlyAddress)).fdvUsd>40000n*W);assert((await factory.graduationStatus(earlyAddress)).quoteUsd>=parseEther('2500.01'));
 for(const action of [()=>factory.buyCurve.staticCall(earlyAddress,W,buyer),()=>factory.sellCurve.staticCall(earlyAddress,W,buyer),()=>factory.executeGraduation.staticCall(earlyAddress),()=>factory.refreshEligibility.staticCall(earlyAddress),()=>hook.register.staticCall(earlyAddress,0),()=>hook.withdrawRewards.staticCall(earlyAddress),()=>hook.unlockCallback.staticCall('0x'),()=>router.unlockCallback.staticCall('0x'),()=>router.convertRewards.staticCall(W,1n,buyer)])await assert.rejects(action);
 // Complete one graduation at the checked RWI reference price using the actual ETH/RWI route.
 await restore();const reference=27281636050000n;await setPrice(reference);const actual=await create(300,true),actualToken=await actual.getAddress();await eligibleFill(actualToken);await rpc.send('evm_increaseTime',[301]);await rpc.send('evm_mine',[]);await setPrice(reference);await(await factory.graduate(actualToken,{gasLimit:3000000})).wait();const actualRecord=await factory.launches(actualToken);assert.equal(actualRecord.phase,2n);assert(actualRecord.seededQuote*reference/W>=2500n*W);
 await restore();await setPrice(initial);const probe=await deploy('CreatorProbe',[address]);await(await probe.create(initial,hexlify(randomBytes(32)))).wait();const probeToken=await probe.token();await buy(probeToken,1000n*W);const probeReward=await factory.rewardRwi(probeToken),probeState=Array.from(await factory.launches(probeToken));await(await probe.setReject(true)).wait();await assert.rejects(async()=>{await(await probe.claim({gasLimit:2000000})).wait()});assert.equal(await factory.rewardRwi(probeToken),probeReward);assert.deepEqual(Array.from(await factory.launches(probeToken)),probeState);await(await probe.setReject(false)).wait();await(await probe.claim()).wait();assert(await probe.attempted());assert.equal(await probe.reentered(),false);assert.equal(await probe.rejection(),keccak256(Buffer.from('ReentrancyGuardReentrantCall()')).slice(0,10));assert.equal(await factory.rewardRwi(probeToken),0n);
 // Two simultaneous launches must never fund one another or mix rewards.
 await restore();await setPrice(initial);const one=await create(100,true),two=await create(300,false),oneAddress=await one.getAddress(),twoAddress=await two.getAddress();await buy(oneAddress,2000n*W);await buy(twoAddress,4000n*W);const twoState=Array.from(await factory.launches(twoAddress)),twoRewards=await factory.rewardRwi(twoAddress);await sell(oneAddress,(await one.balanceOf(buyer))/2n);await(await factory.claimRewards(oneAddress,1n,await deadline())).wait();assert.deepEqual(Array.from(await factory.launches(twoAddress)),twoState);assert.equal(await factory.rewardRwi(twoAddress),twoRewards);const liability=(await factory.launches(oneAddress)).quoteReserve+(await factory.launches(twoAddress)).quoteReserve+await factory.rewardRwi(oneAddress)+await factory.rewardRwi(twoAddress);assert.equal(await rwi.balanceOf(address),liability);
 const report={concurrentLaunchIsolation:true,reentrantEthClaimRejected:true,rejectedRecipientRollback:true,implementation:{factoryRuntimeHash:keccak256(await rpc.getCode(address)),factoryCreationHash:artifact('RWILaunchV4').creationHash,hookRuntimeHash:keccak256(await rpc.getCode(hookAddress)),routerRuntimeHash:keccak256(await rpc.getCode(routerAddress))},referencePriceGraduation:{rwiUsd:reference,netRwi:actualRecord.seededQuote},testedAt:new Date().toISOString(),localOnly:true,fork:metadata.forkedNetwork,oracle:'Mutable test double; not a production feed',cases,oracleFailureCases:oracleFailures,failedGraduationRedemption:true,currentPriceRechecked:true,zeroFundingPriceRiseRejected:true,exactOutputSwaps:16,claimRollback:true,donationIsolation:true,mainnetTransactions:0};fs.writeFileSync(path.join(__dirname,'artifacts/fork-validation.json'),json(report));console.log('PASS fork validation',json(report));
})().catch(e=>{console.error(e);process.exitCode=1});
