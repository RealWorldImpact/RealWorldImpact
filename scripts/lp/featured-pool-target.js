import { getAddress } from 'ethers';
import { RWI, ZERO, poolId } from './protocol.js';
export const PONS_HOOK='0xe5e702641ea86f4ae6cc3cdaed2b886f976be044';
// A hook with these flags can change liquidity or take a liquidity delta.
// Such pools need their own deposit integration, not an empty hookData call.
export function supportsLiquidity(key){
  try{return (BigInt(getAddress(key.hooks))&0xf03n)===0n;}catch{return false;}
}
export function validateFeaturedKey(id,raw){
  if(!/^0x[0-9a-fA-F]{64}$/.test(id))throw Error('This featured market is not a Uniswap v4 pool.');
  const key={currency0:getAddress(raw.currency0??raw[0]),currency1:getAddress(raw.currency1??raw[1]),fee:Number(raw.fee??raw[2]),tickSpacing:Number(raw.tickSpacing??raw[3]),hooks:getAddress(raw.hooks??raw[4])};
  if(BigInt(key.currency0)>=BigInt(key.currency1)||![key.currency0.toLowerCase(),key.currency1.toLowerCase()].includes(RWI)||!Number.isInteger(key.tickSpacing)||key.tickSpacing<1||key.tickSpacing>32767||!Number.isInteger(key.fee)||key.fee<0||(key.fee>=1000000&&key.fee!==0x800000)||poolId(key)!==id.toLowerCase())throw Error('The featured pool could not be verified. Try refreshing the pool list.');
  if(!supportsLiquidity(key))throw Error('This pool requires a custom liquidity integration. Choose another featured pool.');
  return key;
}
export async function readFeaturedKey(manager,id){
  if(!/^0x[0-9a-fA-F]{64}$/.test(id))throw Error('This featured market is not a Uniswap v4 pool.');
  // The manager indexes keys by the first 25 bytes. Verify all 32 bytes after lookup.
  return validateFeaturedKey(id,await manager.poolKeys(id.slice(0,52)));
}
export function assertFeaturedDeposit(id,live,position){
  if(!id)return;
  if(!live.exists||live.id.toLowerCase()!==id.toLowerCase()||poolId(live.key)!==id.toLowerCase()||(position&&position.pool.poolId.toLowerCase()!==id.toLowerCase()))throw Error('The deposit no longer matches the selected featured pool. Select the pool again.');
}
export function hookLabel(key){return key.hooks.toLowerCase()===ZERO?'None':key.hooks.toLowerCase()===PONS_HOOK?'Pons trading hook':'Custom trading hook';}
export function lpFeeLabel(key,slot){return key.fee===0x800000?(slot?Number(slot[3])/10000+'% (variable)':'Variable'):key.fee/10000+'%';}
