import { Interface } from 'ethers';
import { uncollectedFees } from './position-fees.js';
const multi=new Interface(['function aggregate3((address target,bool allowFailure,bytes callData)[] calls) view returns ((bool success,bytes returnData)[])']);
const managerAbi=new Interface(['function ownerOf(uint256) view returns(address)','function getPoolAndPositionInfo(uint256) view returns((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks),uint256)','function getPositionLiquidity(uint256) view returns(uint128)']);
const tokenAbi=new Interface(['function decimals() view returns(uint8)','function symbol() view returns(string)','function name() view returns(string)']);
const stateAbi=new Interface(['function getSlot0(bytes32) view returns(uint160,int24,uint24,uint24)','function getLiquidity(bytes32) view returns(uint128)','function getPositionInfo(bytes32,address,int24,int24,bytes32) view returns(uint128,uint256,uint256)','function getFeeGrowthInside(bytes32,int24,int24) view returns(uint256,uint256)']);
async function batch(rpc,calls){
  const rows=[];
  for(let i=0;i<calls.length;i+=120){
    const chunk=calls.slice(i,i+120),data=await rpc.call({to:'0xca11bde05977b3631167028862be2a173976ca11',data:multi.encodeFunctionData('aggregate3',[chunk.map(c=>({target:c.to,allowFailure:true,callData:c.abi.encodeFunctionData(c.method,c.args||[])}))])});
    const results=multi.decodeFunctionResult('aggregate3',data)[0];if(results.length!==chunk.length)throw Error('Invalid position response');
    rows.push(...results.map((r,j)=>{try{return r.success?chunk[j].abi.decodeFunctionResult(chunk[j].method,r.returnData):null;}catch{return null;}}));
  }
  return rows;
}
export async function readPositionsFast(rpc,ids,who,epoch,P,cache=new Map()){
  if(!ids.length)return {items:[],failed:0};
  const raw=await batch(rpc,ids.flatMap(id=>['ownerOf','getPoolAndPositionInfo','getPositionLiquidity'].map(method=>({to:P.CONTRACTS.manager,abi:managerAbi,method,args:[id]}))));
  const headers=[];let failed=0;
  for(let i=0;i<ids.length;i++){
    const [owner,result,liq]=raw.slice(i*3,i*3+3);if(!owner)continue;
    if(owner[0].toLowerCase()!==who.toLowerCase())continue;
    if(!result||!liq){failed++;continue;}
    const r=result[0],key={currency0:r[0],currency1:r[1],fee:Number(r[2]),tickSpacing:Number(r[3]),hooks:r[4]};
    if(![key.currency0.toLowerCase(),key.currency1.toLowerCase()].includes(P.RWI))continue;
    headers.push({id:ids[i],key,info:result[1],liquidity:liq[0]});
  }
  const addresses=[...new Set(headers.flatMap(h=>[h.key.currency0.toLowerCase(),h.key.currency1.toLowerCase()]))];
  const missing=addresses.filter(a=>a!==P.ZERO&&!Number.isInteger(cache.get(a)?.decimals));
  const metadata=await batch(rpc,missing.flatMap(to=>['decimals','symbol','name'].map(method=>({to,abi:tokenAbi,method}))));
  missing.forEach((address,i)=>{const [d,s,n]=metadata.slice(i*3,i*3+3);if(d&&s&&Number(d[0])<=36)cache.set(address,P.token(address,Number(d[0]),String(s[0]).slice(0,24),address===P.WETH?'Wrapped Ether':String(n?.[0]||s[0]).slice(0,80)));});
  const pools=new Map(),items=[];
  for(const h of headers){
    const tokens=[h.key.currency0,h.key.currency1].map(a=>a.toLowerCase()===P.ZERO?{address:P.ZERO,decimals:18,symbol:'ETH'}:cache.get(a.toLowerCase()));
    if(tokens.some(t=>!t)){failed++;continue;}
    const external=h.key.hooks.toLowerCase()!==P.ZERO||tokens.some(t=>t.address.toLowerCase()===P.ZERO),id=P.poolId(h.key);
    const item={id:h.id,who,epoch,liquidity:h.liquidity,external,live:{key:h.key,tokens,id},info:h.info};
    if(external||h.liquidity===0n)items.push(item);else{if(!pools.has(id))pools.set(id,[]);pools.get(id).push(item);}
  }
  const poolIds=[...pools.keys()],funded=[...items,...[...pools.values()].flat()].filter(p=>p.liquidity>0n);
  const feeCalls=funded.flatMap(item=>{const [lower,upper]=P.unpackTicks(item.info);return [{to:P.CONTRACTS.state,abi:stateAbi,method:'getPositionInfo',args:[item.live.id,P.CONTRACTS.manager,lower,upper,'0x'+BigInt(item.id).toString(16).padStart(64,'0')]},{to:P.CONTRACTS.state,abi:stateAbi,method:'getFeeGrowthInside',args:[item.live.id,lower,upper]}];});
  const states=await batch(rpc,[...poolIds.flatMap(id=>['getSlot0','getLiquidity'].map(method=>({to:P.CONTRACTS.state,abi:stateAbi,method,args:[id]}))),...feeCalls]);
  funded.forEach((item,i)=>{item.fees=uncollectedFees(states[poolIds.length*2+i*2],states[poolIds.length*2+i*2+1]);});
  poolIds.forEach((id,i)=>{
    const [slot,liq]=states.slice(i*2,i*2+2),group=pools.get(id);
    if(!slot||!liq){failed+=group.length;return;}
    for(const item of group){try{item.live.pool=P.buildPool(item.live.key,item.live.tokens,slot,liq[0]);item.position=P.ownedPosition(item.live.pool,item.liquidity,item.info);items.push(item);}catch{failed++;}}
  });
  return {items,failed};
}
