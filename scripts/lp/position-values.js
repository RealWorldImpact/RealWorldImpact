import { holdingValue } from './wallet-tokens.js';
const RWI='0xda2598c976e62e7e15dcca75169b404712e48b04';
export function positionValue(position,prices){
  if(position.liquidity===0n)return {valueUsd:0n,estimated:false};
  if(!position.position)return {valueUsd:null,estimated:false};
  const rwi=position.live.tokens.find(t=>t.address.toLowerCase()===RWI);
  let valueUsd=0n,estimated=false;
  for(let i=0;i<2;i++){
    const token=position.live.tokens[i],raw=BigInt(position.position['amount'+i].quotient.toString());
    if(raw===0n)continue;
    let value=holdingValue(raw,token.decimals,prices.get(token.address.toLowerCase()));
    if(value===null&&rwi&&token.address.toLowerCase()!==RWI){
      try{const price=position.live.pool.priceOf(token),inRwi=raw*BigInt(price.numerator.toString())/BigInt(price.denominator.toString());value=holdingValue(inRwi,rwi.decimals,prices.get(RWI));if(value!==null)estimated=true;}catch{}
    }
    if(value===null)return {valueUsd:null,estimated:false};valueUsd+=value;
  }
  return {valueUsd,estimated};
}
export function valuePositions(positions,prices){
  return positions.filter(position=>position.liquidity>0n).map(position=>({position,...positionValue(position,prices)})).sort((a,b)=>{
    if(a.valueUsd===null&&b.valueUsd!==null)return 1;
    if(b.valueUsd===null&&a.valueUsd!==null)return -1;
    if(a.valueUsd!==b.valueUsd)return a.valueUsd>b.valueUsd?-1:1;
    return BigInt(a.position.id)>BigInt(b.position.id)?-1:1;
  });
}
