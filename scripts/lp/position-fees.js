export function uncollectedFees(positionInfo,growth){
  if(!positionInfo||!growth)return null;
  const liquidity=BigInt(positionInfo[0]);
  return [0,1].map(i=>BigInt.asUintN(256,BigInt(growth[i])-BigInt(positionInfo[i+1]))*liquidity/(1n<<128n));
}
