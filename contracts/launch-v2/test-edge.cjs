const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {JsonRpcProvider,Contract,ContractFactory,ZeroAddress,MaxUint256,hexlify,randomBytes,parseEther}=require('../launch/node_modules/ethers');
const artifact=n=>JSON.parse(fs.readFileSync(path.join(__dirname,'artifacts',n+'.json')));
(async()=>{
 const evidence=JSON.parse(fs.readFileSync(path.join(__dirname,'artifacts/fork-test.json'))),rpc=new JsonRpcProvider('http://127.0.0.1:8899',4663,{staticNetwork:true,cacheTimeout:-1});rpc.pollingInterval=100;
 const creator=await rpc.getSigner(0),trader=await rpc.getSigner(5),who=await trader.getAddress();
 const factory=new Contract(evidence.factory,artifact('RWILaunchV2').abi,creator),hook=new Contract(evidence.hook,artifact('RWICreatorHook').abi,rpc),router=new Contract(evidence.router,artifact('RWILaunchRouterV2').abi,trader);
 const helper=await new ContractFactory(artifact('SwapHarness').abi,artifact('SwapHarness').bytecode,trader).deploy();await helper.waitForDeployment();const helperAddress=await helper.getAddress();
 const rwiAddress=await factory.RWI(),rwi=new Contract(rwiAddress,['function balanceOf(address) view returns(uint256)','function approve(address,uint256) returns(bool)'],trader);
 const deadline=async()=>Number((await rpc.getBlock('latest')).timestamp)+120;
 await(await helper.swap({currency0:ZeroAddress,currency1:rwiAddress,fee:0,tickSpacing:200,hooks:await router.RWI_HOOK()},true,-(10n**14n),{value:10n**14n})).wait();
 await(await rwi.approve(helperAddress,MaxUint256)).wait();
 for(const item of evidence.evidence){
   const token=new Contract(item.token,artifact('RWICurveToken').abi,trader),key=Array.from(await factory.keyFor(item.token));
   const out=10n**21n,before=await token.balanceOf(who),feeBefore=await hook.rewards(item.token);
   const delta=await helper.swap.staticCall(key,!item.token0,out);assert.equal(item.token0?delta[0]:delta[1],out);
   await(await helper.swap(key,!item.token0,out)).wait();assert.equal(await token.balanceOf(who)-before,out);assert.ok(await hook.rewards(item.token)>feeBefore);
   await(await token.approve(helperAddress,MaxUint256)).wait();const rwiOut=10n**14n,rwiBefore=await rwi.balanceOf(who),fees=await hook.rewards(item.token);
   const sell=await helper.swap.staticCall(key,item.token0,rwiOut);assert.equal(item.token0?sell[1]:sell[0],rwiOut);
   await(await helper.swap(key,item.token0,rwiOut)).wait();assert.equal(await rwi.balanceOf(who)-rwiBefore,rwiOut);assert.ok(await hook.rewards(item.token)>fees);
 }
 const first=evidence.evidence[0].token,oldRewards=await factory.rewardRwi(first),oldHook=await hook.rewards(first);
 await assert.rejects(async()=>{await(await factory.claimRewards(first,10n**30n,await deadline(),{gasLimit:2000000})).wait()});
 assert.equal(await factory.rewardRwi(first),oldRewards);assert.equal(await hook.rewards(first),oldHook);
 // Simulate a temporary PositionManager failure: reserve movement must roll back, then permissionless retry succeeds.
 const m={name:'Retry test',symbol:'RETRY',logo:'',description:'Local fork only',website:'',twitter:'',telegram:''};
 const launch=await(await factory.launch(m,10n**20n,300,hexlify(randomBytes(32)),await deadline())).wait();
 const event=launch.logs.map(x=>{try{return factory.interface.parseLog(x)}catch{return null}}).find(x=>x?.name==='TokenLaunched'),tokenAddress=event.args.token;
 const pm=await factory.POSITION_MANAGER(),code=await rpc.getCode(pm);await rpc.send('hardhat_setCode',[pm,'0x60006000fd']);
 try{await(await router.buy(tokenAddress,10n**23n,1,await deadline(),{value:parseEther('0.0001'),gasLimit:6000000})).wait();}finally{await rpc.send('hardhat_setCode',[pm,code]);}
 const pending=await factory.launches(tokenAddress);assert.equal(pending.phase,1n);assert.ok(pending.quoteReserve>0n);assert.equal(pending.tokenReserve,pending.reservedTokens);
 await assert.rejects(factory.quoteSell(tokenAddress,1));await assert.rejects(factory.quoteBuy(tokenAddress,1));
 const principalBefore=await rwi.balanceOf(evidence.factory),rewardsBefore=await factory.rewardRwi(tokenAddress);
 await(await factory.connect(trader).graduate(tokenAddress)).wait();assert.equal((await factory.launches(tokenAddress)).phase,2n);assert.equal(await factory.rewardRwi(tokenAddress),rewardsBefore);assert.ok(principalBefore-await rwi.balanceOf(evidence.factory)<=pending.quoteReserve);
 // Nonzero donations do not alter tracked reserves or create claimable rewards.
 const token=new Contract(tokenAddress,artifact('RWICurveToken').abi,trader),record=Array.from(await factory.launches(tokenAddress)),rewards=await factory.rewardRwi(tokenAddress);
 await(await token.transfer(evidence.factory,1n)).wait();assert.deepEqual(Array.from(await factory.launches(tokenAddress)),record);assert.equal(await factory.rewardRwi(tokenAddress),rewards);
 fs.writeFileSync(path.join(__dirname,'artifacts/edge-test.json'),JSON.stringify({testedAt:new Date().toISOString(),factory:evidence.factory,exactOutputCases:8,retryGraduation:tokenAddress,claimRollback:true,donationIsolation:true},null,2));
 console.log('PASS: eight exact-output hook swaps, reverted ETH claim restores rewards, failed automatic graduation preserves reserves, permissionless retry, closed pending curve and donation isolation. Local fork only.');
})().catch(e=>{console.error(e);process.exitCode=1});
