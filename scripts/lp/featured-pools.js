import { safeTokenLogo } from './wallet-tokens.js';
const RWI='robinhood_0xda2598c976e62e7e15dcca75169b404712e48b04';
export function rankFeaturedPools(pages){
  const pools=new Map();
  for(const body of pages){
    const included=new Map((body.included||[]).map(t=>[t.id,t]));
    for(const p of body.data||[]){
      const a=p.attributes||{},base=p.relationships?.base_token?.data?.id,quote=p.relationships?.quote_token?.data?.id;
      if(base!==RWI&&quote!==RWI)continue;
      const volume=Number(a.volume_usd?.h24),liquidity=Number(a.reserve_in_usd),address=String(a.address||'').toLowerCase();
      if(!/^0x(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(address)||!Number.isFinite(volume)||volume<=0||!Number.isFinite(liquidity)||liquidity<=0)continue;
      const other=included.get(base===RWI?quote:base)?.attributes||{},dex=p.relationships?.dex?.data?.id;
      pools.set(address,{address,name:String(a.name||'RWI pool').slice(0,80),volume24h:volume,liquidityUsd:liquidity,dex:String(included.get(dex)?.attributes?.name||dex||'Exchange').slice(0,60),other:{address:String(other.address||'').toLowerCase(),symbol:String(other.symbol||'TOKEN').slice(0,24),name:String(other.name||other.symbol||'Token').slice(0,80),logo:safeTokenLogo(other.image_url)},url:'https://www.geckoterminal.com/robinhood/pools/'+address});
    }
  }
  return [...pools.values()].sort((a,b)=>b.volume24h-a.volume24h||b.liquidityUsd-a.liquidityUsd||a.address.localeCompare(b.address)).slice(0,3);
}
