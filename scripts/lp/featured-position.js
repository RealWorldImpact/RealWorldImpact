import { TickMath, nearestUsableTick } from '@uniswap/v3-sdk';
import { discoverPositionIds } from './position-discovery.js';
import { readPositionsFast } from './position-reader.js';

// Only reuse the same full-range position the featured deposit would create.
// A narrower position has different exposure and must be selected explicitly.
export function selectFeaturedPosition(items,poolId,who,epoch,tickSpacing){
  const lower=nearestUsableTick(TickMath.MIN_TICK,tickSpacing),upper=nearestUsableTick(TickMath.MAX_TICK,tickSpacing);
  return items.filter(p=>p.who?.toLowerCase()===who.toLowerCase()&&p.epoch===epoch&&!p.external&&p.liquidity>0n&&p.live.id.toLowerCase()===poolId.toLowerCase()&&p.position?.tickLower===lower&&p.position?.tickUpper===upper)
    .sort((a,b)=>a.liquidity===b.liquidity?(BigInt(a.id)<BigInt(b.id)?-1:1):a.liquidity>b.liquidity?-1:1)[0]||null;
}

export async function findFeaturedPosition({rpc,who,epoch,poolId,key,P,cache,knownIds=[],checkpoint}){
  const scan=await discoverPositionIds(rpc,P.CONTRACTS.manager,who,checkpoint);
  if(scan.partial)throw Error('Your existing positions could not be fully checked. Try again before depositing.');
  const ids=[...new Set([...scan.ids,...knownIds])];
  const result=await readPositionsFast(rpc,ids,who,epoch,P,cache);
  if(result.failed)throw Error('Your existing positions are still syncing. Try again before depositing.');
  return {position:selectFeaturedPosition(result.items,poolId,who,epoch,key.tickSpacing),scan};
}
