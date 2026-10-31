// Research transactions ONLY on a verified local Hardhat fork. No mainnet signer.
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {JsonRpcProvider,JsonRpcSigner,Contract,ContractFactory,MaxUint256,parseEther,formatEther,toBeHex}=require('../launch/node_modules/ethers');
const RWI='0xda2598c976e62e7e15dcca75169b404712e48b04',WETH='0x0bd7d308f8e1639fab988df18a8011f41eacad73';
const V3_FACTORY='0x1f7d7550b1b028f7571e69a784071f0205fd2efa',NPM='0x73991a25c818bf1f1128deaab1492d45638de0d3',ROUTER='0xcaf681a66d020601342297493863e78c959e5cb2';
const V4_MANAGER='0x8366a39cc670b4001a1121b8f6a443a643e40951',STATE='0xf3334192d15450cdd385c8b70e03f9a6bd9e673b',MAIN_POOL='0xa72a9de2c6e3db34308a8ae61e927ceffea630218ca1e712b70b61341c3e99a1';
const ABI=JSON.parse(fs.readFileSync(path.join(__dirname,'../../scripts/lp/node_modules/@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json'))).abi;
const artifact=JSON.parse(fs.readFileSync(path.join(__dirname,'artifacts/reader.json')));
const json=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v,2);
(async()=>{
 const rpc=new JsonRpcProvider('http://127.0.0.1:8902',4663,{staticNetwork:true,cacheTimeout:-1});rpc.pollingInterval=30;
 try{
  let metadata=await rpc.send('hardhat_metadata',[]);
  assert.equal(metadata.chainId,4663);assert(metadata.forkedNetwork,'Must be an isolated fork');
  await rpc.send('hardhat_reset',[{forking:{jsonRpcUrl:'https://rpc.mainnet.chain.robinhood.com'}}]);
  metadata=await rpc.send('hardhat_metadata',[]);
  await rpc.send('evm_mine',[]); // Use the configured local hardfork for subsequent calls.
  const signer=await rpc.getSigner(0),who=await signer.getAddress(),trader=await rpc.getSigner(1),buyer=await trader.getAddress();
  const now=async()=>Number((await rpc.getBlock('latest')).timestamp),advance=async seconds=>{await rpc.send('evm_increaseTime',[seconds]);await rpc.send('evm_mine',[]);};
  const rwi=new Contract(RWI,['function balanceOf(address) view returns(uint256)','function transfer(address,uint256) returns(bool)','function approve(address,uint256) returns(bool)'],signer);
  const weth=new Contract(WETH,['function deposit() payable','function approve(address,uint256) returns(bool)','function balanceOf(address) view returns(uint256)'],signer);
  const factory=new Contract(V3_FACTORY,['function getPool(address,address,uint24) view returns(address)'],signer);
  const state=new Contract(STATE,['function getSlot0(bytes32) view returns(uint160,int24,uint24,uint24)'],rpc);
  const [sqrt]=await state.getSlot0(MAIN_POOL);
  const seedEth=parseEther('1'),seedRwi=seedEth*sqrt*sqrt/(1n<<192n);
  assert((await rwi.balanceOf(V4_MANAGER))>seedRwi,'Fixture needs actual RWI balances in the fork');
  // Move existing RWI into a TEST wallet on this fork only; never a production funding method.
  await rpc.send('hardhat_impersonateAccount',[V4_MANAGER]);await rpc.send('hardhat_setBalance',[V4_MANAGER,toBeHex(parseEther('10'))]);
  await(await rwi.connect(new JsonRpcSigner(rpc,V4_MANAGER)).transfer(who,seedRwi)).wait();
  await rpc.send('hardhat_stopImpersonatingAccount',[V4_MANAGER]);
  await(await weth.deposit({value:seedEth})).wait();await(await weth.connect(trader).deposit({value:parseEther('10')})).wait();
  const pm=new Contract(NPM,ABI,signer);
  await(await pm.createAndInitializePoolIfNecessary(WETH,RWI,3000,sqrt)).wait();
  const poolAddress=await factory.getPool(WETH,RWI,3000);
  const pool=new Contract(poolAddress,['function increaseObservationCardinalityNext(uint16)','function liquidity() view returns(uint128)','function observe(uint32[]) view returns(int56[],uint160[])','function slot0() view returns(uint160,int24,uint16,uint16,uint16,uint8,bool)'],signer);
  await(await pool.increaseObservationCardinalityNext(64)).wait();
  await(await rwi.approve(NPM,seedRwi)).wait();await(await weth.approve(NPM,seedEth)).wait();
  const mint=await(await pm.mint({token0:WETH,token1:RWI,fee:3000,tickLower:-887220,tickUpper:887220,amount0Desired:seedEth,amount1Desired:seedRwi,amount0Min:1,amount1Min:1,recipient:who,deadline:await now()+1200})).wait();
  const transfer=mint.logs.map(x=>{try{return pm.interface.parseLog(x)}catch{return null}}).find(x=>x?.name==='Transfer'&&x.args.to.toLowerCase()===who.toLowerCase());
  assert(transfer,'Mint must issue a real position');const tokenId=transfer.args.tokenId;
  const reader=await new ContractFactory(artifact.abi,artifact.bytecode,signer).deploy(poolAddress);await reader.waitForDeployment();
  await assert.rejects(reader.read(),'Insufficient genuine observation history must fail');
  await advance(1801);
  const baseline=await reader.read();assert(baseline.withinTwoPercent);assert(baseline.conservative>0n);assert(baseline.currentLiquidity>0n);assert(baseline.harmonicLiquidity30m>0n);
  // These are real v3 accumulator reads, not periodic observations of spot prices.
  const [ticks]=await pool.observe([1800,0]);const tickDelta=ticks[1]-ticks[0];let mean=tickDelta/1800n;if(tickDelta>0n&&tickDelta%1800n)mean++;
  const ethFeed=new Contract('0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9',['function latestRoundData() view returns(uint80,int256,uint256,uint256,uint80)'],rpc);
  const round=await ethFeed.latestRoundData(),expected=Number(round[1])/1e8/Math.pow(1.0001,Number(mean));
  assert(Math.abs(Number(baseline.price30m)/1e18/expected-1)<1e-8,'Independent price conversion');
  assert.equal(baseline.ethUpdatedAt,round[3],'Keep actual ETH feed timestamp');
  let root=await rpc.send('evm_snapshot',[]);
  const router=new Contract(ROUTER,['function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns(uint256)'],trader);
  await(await weth.connect(trader).approve(ROUTER,MaxUint256)).wait();
  await(await router.exactInputSingle({tokenIn:WETH,tokenOut:RWI,fee:3000,recipient:buyer,amountIn:parseEther('2'),amountOutMinimum:1,sqrtPriceLimitX96:0},{gasLimit:1000000})).wait();
  const instant=await reader.read();assert(instant.spot>baseline.spot*8n);assert.equal(instant.price30m,baseline.price30m);assert(!instant.withinTwoPercent);
  await advance(300);
  const heldFiveMinutes=await reader.read();assert(heldFiveMinutes.price30m>baseline.price30m);assert(!heldFiveMinutes.withinTwoPercent);
  await advance(1801);
  const sustained=await reader.read();assert(sustained.withinTwoPercent);assert(sustained.conservative>baseline.conservative*8n,'A long sustained manipulation defeats a thin-pool TWAP: do not certify this as secure.');
  const bought=await rwi.balanceOf(buyer);await(await rwi.connect(trader).approve(ROUTER,bought)).wait();
  const cashBefore=await weth.balanceOf(buyer);
  await(await router.exactInputSingle({tokenIn:RWI,tokenOut:WETH,fee:3000,recipient:buyer,amountIn:bought,amountOutMinimum:1,sqrtPriceLimitX96:0},{gasLimit:1000000})).wait();
  const returned=(await weth.balanceOf(buyer))-cashBefore,cost=parseEther('2')-returned;
  const unwind=await reader.read();assert(!unwind.withinTwoPercent);assert(unwind.conservative<baseline.spot*102n/100n,'Post-unwind conservative quote must follow the lower spot');
  await rpc.send('evm_revert',[root]);root=await rpc.send('evm_snapshot',[]);
  const position=await pm.positions(tokenId);
  await(await pm.decreaseLiquidity({tokenId,liquidity:position.liquidity,amount0Min:0,amount1Min:0,deadline:await now()+1200})).wait();
  await assert.rejects(reader.read(),'An emptied reference market must be unusable');
  await rpc.send('evm_revert',[root]);await advance(86401);await assert.rejects(reader.read(),'Expired ETH/USD component must be unusable');
  const price=x=>Number(formatEther(x));
  const report={testedAt:new Date().toISOString(),status:'Research proof, NOT production-ready',mainnetTransactions:0,fork:metadata.forkedNetwork,localReferencePool:poolAddress,
   fixture:{eth:price(seedEth),rwi:price(seedRwi),note:'Artificially allocated on local fork only; no mainnet liquidity exists at this pool.'},
   baseline:{rwiUsd:price(baseline.price30m),ethSourceUpdatedAt:Number(round[3]),marketWindowSeconds:1800},
   checks:['Reject insufficient pool history','Real v3 accumulators and independent inverse-price conversion','Preserve ETH feed timestamp','Ignore instantaneous price spike in 30-minute average','Reject 5-minute divergence','Reject withdrawn reference liquidity','Reject expired ETH/USD feed'],
   counterexample:{spotMultiple:price(instant.spot)/price(baseline.spot),sustainedPriceMultiple:price(sustained.conservative)/price(baseline.conservative),grossManipulationEth:2,netRoundTripCostEth:price(cost),netRoundTripCostUsd:price(cost)*Number(round[1])/1e8,excludes:'Gas and arbitrage by other market participants; isolated fork has no competing traders.',conclusion:'Time averaging and spot agreement alone are insufficient for this thin reference pool.'},
   remaining:['A real funded reference market with reviewed wide-range depth and withdrawal protections','Economic manipulation analysis against aggregate launch exposure','Sequencer outage/recovery policy and observation retention under high swap frequency','Price policy for rapid growth and reliable history; two-percent agreement can pause during volatility','Production adapter and complete launch integration/fork review']};
  fs.writeFileSync(path.join(__dirname,'validation.json'),json(report)+'\n');console.log(json(report));
 }finally{rpc.destroy();}
})().catch(e=>{console.error(e);process.exitCode=1});
