const assert=require('assert/strict'),fs=require('fs'),path=require('path');
const {JsonRpcProvider,Contract,ContractFactory,randomBytes,hexlify,ZeroAddress,AbiCoder,keccak256,concat,getCreate2Address,id}=require('ethers');
const endpoint='http://127.0.0.1:8899';
const artifact=name=>JSON.parse(fs.readFileSync(path.join(__dirname,'artifacts',name+'.json')));
(async()=>{
 const rpc=new JsonRpcProvider(endpoint,4663,{staticNetwork:true,cacheTimeout:-1});
 await rpc.send('hardhat_reset',[{forking:{jsonRpcUrl:'https://rpc.mainnet.chain.robinhood.com'}}]);
 const signer=await rpc.getSigner(0),who=await signer.getAddress(),a=artifact('RWILaunchFactory');
 const factory=await new ContractFactory(a.abi,a.bytecode,signer).deploy();await factory.waitForDeployment();
 const address=await factory.getAddress(),rwi=new Contract(await factory.RWI(),['function balanceOf(address) view returns(uint256)'],rpc);
 assert.equal(await rwi.balanceOf(who),0n);
 const manager=new Contract(await factory.POSITION_MANAGER(),['function ownerOf(uint256) view returns(address)','function getPositionLiquidity(uint256) view returns(uint128)'],rpc);
 const deadline=async()=>Number((await rpc.getBlock('latest')).timestamp)+1100;
 const m={name:'Local Fork Test',symbol:'LTEST',logo:'',description:'Local test only',website:'',twitter:'',telegram:''};
 const types=new Set(),tokens=[];let first;
 for(const desiredOrder of [true,false]){
   let salt,predicted;
   const initHash=keccak256(concat([artifact('RWILaunchToken').bytecode,AbiCoder.defaultAbiCoder().encode(['string','string','string','string','string','string','string','address'],[m.name,m.symbol,m.logo,m.description,m.website,m.twitter,m.telegram,who])]));
   do{salt=hexlify(randomBytes(32));predicted=getCreate2Address(address,keccak256(AbiCoder.defaultAbiCoder().encode(['address','bytes32'],[who,salt])),initHash);}while((BigInt(predicted)<BigInt(await factory.RWI()))!==desiredOrder);
   const receipt=await(await factory.launch(m,-69000,salt,await deadline())).wait();
   const event=receipt.logs.map(l=>{try{return factory.interface.parseLog(l)}catch{return null}}).find(l=>l?.name==='TokenLaunched');
   assert.ok(event);assert.equal(event.args.token,predicted);const token=event.args.token,launch=await factory.launches(token);first??=token;tokens.push(token);types.add(launch.token0);
   assert.equal(launch.creator,who);assert.equal(await manager.ownerOf(launch.positionId),address);assert.ok(await manager.getPositionLiquidity(launch.positionId)>0n);
   assert.equal(await rwi.balanceOf(who),0n);assert.equal(await rwi.balanceOf(address),0n);
   const t=new Contract(token,artifact('RWILaunchToken').abi,rpc);assert.equal(await t.totalSupply(),10n**27n);assert.equal(await t.balanceOf(who),0n);assert.equal(await t.allowance(address,await factory.PERMIT2()),0n);
   const before=await manager.getPositionLiquidity(launch.positionId);await(await factory.connect(await rpc.getSigner(1)).claimFees(token)).wait();assert.equal(await manager.getPositionLiquidity(launch.positionId),before);
 }
 assert.equal(types.size,2);assert.equal(await factory.launchCount(),2n);assert.equal(await factory.launchedTokens(0),first);
 const trader=await rpc.getSigner(3),traderAddress=await trader.getAddress();
 const routerAddress=await factory.router(),router=new Contract(routerAddress,artifact('RWILaunchRouter').abi,trader);
 const quoter=new Contract('0x8dc178efb8111bb0973dd9d722ebeff267c98f94',['function quoteExactInput((address exactCurrency,(address intermediateCurrency,uint24 fee,int24 tickSpacing,address hooks,bytes hookData)[] path,uint128 exactAmount) params) returns(uint256 amountOut,uint256 gasEstimate)'],rpc);
 const rwiAddress=await factory.RWI(),hook=await router.RWI_HOOK(),input=1000000000000n;
 for(const tradedToken of tokens){
 const launch=await factory.launches(tradedToken),t=new Contract(tradedToken,artifact('RWILaunchToken').abi,trader);
 assert.equal(await rwi.balanceOf(traderAddress),0n);
 const [buyQuote]=await quoter.quoteExactInput.staticCall({exactCurrency:ZeroAddress,path:[{intermediateCurrency:rwiAddress,fee:0,tickSpacing:200,hooks:hook,hookData:'0x'},{intermediateCurrency:tradedToken,fee:10000,tickSpacing:200,hooks:ZeroAddress,hookData:'0x'}],exactAmount:input});
 const buyReceipt=await(await router.buy(tradedToken,buyQuote,await deadline(),{value:input})).wait();
 const trade=buyReceipt.logs.map(l=>{try{return router.interface.parseLog(l)}catch{return null}}).find(l=>l?.name==='Trade');assert.ok(trade.args.rwiRouted>0n);
 const swapTopic=id('Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)'),swapLogs=buyReceipt.logs.filter(l=>l.topics[0]===swapTopic);
 assert.equal(swapLogs.length,2);assert.equal(swapLogs[0].topics[1],'0xa72a9de2c6e3db34308a8ae61e927ceffea630218ca1e712b70b61341c3e99a1');assert.equal(swapLogs[1].topics[1],launch.poolId);
 const bought=await t.balanceOf(traderAddress);assert.equal(bought,buyQuote);assert.ok(bought>0n);assert.equal(await rwi.balanceOf(traderAddress),0n);
 const [sellQuote]=await quoter.quoteExactInput.staticCall({exactCurrency:tradedToken,path:[{intermediateCurrency:rwiAddress,fee:10000,tickSpacing:200,hooks:ZeroAddress,hookData:'0x'},{intermediateCurrency:ZeroAddress,fee:0,tickSpacing:200,hooks:hook,hookData:'0x'}],exactAmount:bought/2n});
 await(await t.approve(routerAddress,bought/2n)).wait();const beforeEth=await rpc.getBalance(traderAddress),sellReceipt=await(await router.sell(tradedToken,bought/2n,sellQuote,await deadline())).wait();
 const sellEvent=sellReceipt.logs.map(l=>{try{return router.interface.parseLog(l)}catch{return null}}).find(l=>l?.name==='Trade');assert.equal(sellEvent.args.amountOut,sellQuote);assert.ok(sellEvent.args.amountOut>0n);
 const sellSwaps=sellReceipt.logs.filter(l=>l.topics[0]===swapTopic);assert.equal(sellSwaps.length,2);assert.equal(sellSwaps[0].topics[1],launch.poolId);assert.equal(sellSwaps[1].topics[1],swapLogs[0].topics[1]);assert.equal(await t.allowance(traderAddress,routerAddress),0n);
 assert.equal(await rpc.getBalance(traderAddress),beforeEth+sellEvent.args.amountOut-sellReceipt.fee);assert.equal(await rwi.balanceOf(traderAddress),0n);assert.equal(await rwi.balanceOf(routerAddress),0n);assert.equal(await rpc.getBalance(routerAddress),0n);
 const beforeLiquidity=await manager.getPositionLiquidity(launch.positionId);await(await factory.connect(await rpc.getSigner(2)).claimFees(tradedToken)).wait();assert.ok(await rwi.balanceOf(who)>0n);assert.equal(await manager.getPositionLiquidity(launch.positionId),beforeLiquidity);
 }
 await assert.rejects(router.buy.staticCall(first,10n**40n,await deadline(),{value:1000000000000n}));await assert.rejects(router.buy.staticCall(first,1n,0,{value:1n}));await assert.rejects(router.buy.staticCall(ZeroAddress,1n,await deadline(),{value:1n}));await assert.rejects(router.unlockCallback.staticCall('0x'));
 for(const tick of [-800001,800001,1])await assert.rejects(factory.launch.staticCall(m,tick,hexlify(randomBytes(32)),await deadline()));
 await assert.rejects(factory.launch.staticCall({...m,name:''},0,hexlify(randomBytes(32)),await deadline()));
 await assert.rejects(factory.launch.staticCall(m,0,hexlify(randomBytes(32)),await deadline(),{value:1n}));
 await assert.rejects(factory.launch.staticCall(m,0,hexlify(randomBytes(32)),0));await assert.rejects(factory.claimFees.staticCall(ZeroAddress));
 assert.equal(a.abi.filter(x=>x.type==='function'&&/withdraw|transfer|execute|upgrade|owner|mint/i.test(x.name)).length,0);
 console.log('PASS: real v4 launches, both token orders, no creator RWI/launch fee, fixed supply, locked NFT, ETH-RWI-token buys and reverse sells, exact two-pool events, no trader RWI/router residuals, creator fees, slippage/deadlines, invalid inputs and no withdrawal/admin surface. Local fork writes only.');
 fs.writeFileSync(path.join(__dirname,'artifacts/fork-test.json'),JSON.stringify({factory:address,router:routerAddress,firstToken:first,tokens,creator:who,trader:traderAddress,chain:4663,endpoint,tokenOrders:types.size,testedAt:new Date().toISOString()}));
})().catch(e=>{console.error({message:e.shortMessage||e.message,action:e.action,data:e.data,to:e.transaction?.to,info:e.info?.error});process.exitCode=1});
