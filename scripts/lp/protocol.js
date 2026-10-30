import { Token, Percent } from '@uniswap/sdk-core';
import { Pool, Position, V4PositionManager } from '@uniswap/v4-sdk';
import { TickMath, nearestUsableTick, encodeSqrtRatioX96 } from '@uniswap/v3-sdk';
import { getAddress, parseUnits, formatUnits, AbiCoder, keccak256 } from 'ethers';

export const CHAIN = 4663;
// Uniswap's v4 liquidity SDK example uses Percent(50, 10_000), or 0.5%.
export const DEFAULT_SLIPPAGE_BPS = 50;
export const RWI = '0xda2598c976e62e7e15dcca75169b404712e48b04';
export const WETH = '0x0bd7d308f8e1639fab988df18a8011f41eacad73';
export const ZERO = '0x0000000000000000000000000000000000000000';
export const CONTRACTS = Object.freeze({
  manager:'0x58daec3116aae6d93017baaea7749052e8a04fa7',
  pool:'0x8366a39cc670b4001a1121b8f6a443a643e40951',
  state:'0xf3334192d15450cdd385c8b70e03f9a6bd9e673b',
  permit:'0x000000000022d473030f116ddee9f6b43ac78ba3'
});
export const FEES = Object.freeze({100:1,500:10,3000:60,10000:200});
export const ERC20 = ['function name() view returns(string)','function symbol() view returns(string)','function decimals() view returns(uint8)','function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)','function approve(address,uint256) returns(bool)'];
export const MANAGER = ['function poolManager() view returns(address)','function permit2() view returns(address)','function ownerOf(uint256) view returns(address)','function getPositionLiquidity(uint256) view returns(uint128)','function getPoolAndPositionInfo(uint256) view returns((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks),uint256)','event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)'];
export const STATE = ['function getSlot0(bytes32) view returns(uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)','function getLiquidity(bytes32) view returns(uint128)'];
export const PERMIT = ['function allowance(address,address,address) view returns(uint160 amount,uint48 expiration,uint48 nonce)','function approve(address token,address spender,uint160 amount,uint48 expiration)'];
export function token(address, decimals, symbol, name=symbol) { return new Token(CHAIN,getAddress(address),decimals,symbol,name); }
export function pair(other, fee) {
  if(other.address.toLowerCase()===RWI) throw Error('Choose a different token to pair with RWI.');
  const spacing=FEES[fee]; if(!spacing)throw Error('Choose a supported fee tier.');
  return Pool.getPoolKey(token(RWI,18,'RWI'),other,Number(fee),spacing,ZERO);
}
export function poolId(k) {return keccak256(AbiCoder.defaultAbiCoder().encode(['address','address','uint24','int24','address'],[k.currency0,k.currency1,k.fee,k.tickSpacing,k.hooks]));}
export function amount(value, decimals) {
  if(!/^(?:\d+)(?:\.\d+)?$/.test(value.trim()))throw Error('Enter a positive token amount without commas.');
  const n=parseUnits(value.trim(),decimals); if(n<=0n||n>=(1n<<128n))throw Error('The token amount is outside the supported range.'); return n;
}
export function buildPool(k, tokens, slot, liquidity='0', initial) {
  let sqrt=slot[0].toString(),tick=Number(slot[1]);
  if(BigInt(sqrt)===0n){if(!initial)throw Error('This pool is not initialized.');const encoded=encodeSqrtRatioX96(initial[1].toString(),initial[0].toString());tick=TickMath.getTickAtSqrtRatio(encoded);sqrt=encoded.toString();}
  return new Pool(tokens[0],tokens[1],Number(k.fee),Number(k.tickSpacing),k.hooks,sqrt,liquidity.toString(),tick);
}
export function makeDeposit(pool, budgets, slippageBps, ticks) {
  if(![50,100,300].includes(slippageBps))throw Error('Unsupported slippage.');
  const lower=ticks?.[0]??nearestUsableTick(TickMath.MIN_TICK,pool.tickSpacing);
  const upper=ticks?.[1]??nearestUsableTick(TickMath.MAX_TICK,pool.tickSpacing);
  // Reserve headroom so slippage-adjusted maxima never exceed the typed budgets.
  const padded=budgets.map(n=>n*10000n/BigInt(10000+slippageBps)-2n);
  if(padded.some(n=>n<=0n))throw Error('Amounts are too small for this token.');
  const p=Position.fromAmounts({pool,tickLower:lower,tickUpper:upper,amount0:padded[0].toString(),amount1:padded[1].toString(),useFullPrecision:true});
  if(BigInt(p.liquidity.toString())===0n)throw Error('Amounts are too small to create liquidity.');
  const max=p.mintAmountsWithSlippage(new Percent(slippageBps,10000));
  const caps=[BigInt(max.amount0.toString()),BigInt(max.amount1.toString())];
  if(caps.some((n,i)=>n>budgets[i]||n>=(1n<<128n)))throw Error('Deposit exceeds your limits. Reduce amounts and try again.');
  return {position:p,caps};
}
export function addCall(position, account, slip, deadline, create=false, id) {
  const options={slippageTolerance:new Percent(slip,10000),deadline:String(deadline)};
  return V4PositionManager.addCallParameters(position,id?{...options,tokenId:id}:{...options,recipient:account,createPool:create,sqrtPriceX96:position.pool.sqrtRatioX96});
}
export function removeCall(position, id, percentage, slip, deadline) {
  if(!Number.isInteger(percentage)||percentage<1||percentage>100)throw Error('Choose 1% to 100%.');
  return V4PositionManager.removeCallParameters(position,{tokenId:id,liquidityPercentage:new Percent(percentage,100),slippageTolerance:new Percent(slip,10000),deadline:String(deadline),burnToken:false});
}
export function collectCall(position,id,account,deadline) {return V4PositionManager.collectCallParameters(position,{tokenId:id,recipient:account,slippageTolerance:new Percent(DEFAULT_SLIPPAGE_BPS,10000),deadline:String(deadline)});}
export function unpackTicks(info) {const signed=n=>Number(BigInt.asIntN(24,n));return [signed((info>>8n)&0xffffffn),signed((info>>32n)&0xffffffn)];}
export function ownedPosition(pool,liquidity,info) {const [tickLower,tickUpper]=unpackTicks(info);return new Position({pool,liquidity:liquidity.toString(),tickLower,tickUpper});}
export { formatUnits, Percent, Position };
