export const SWAP_TOPIC='0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f';
export const POOL_MANAGER='0x8366a39cc670b4001a1121b8f6a443a643e40951';
export async function volumeWindow(rpc,cutoff){
  const latest=await rpc('eth_getBlockByNumber',['latest',false]);
  if(!latest)throw Error('Chain unavailable');
  let high=Number(BigInt(latest.number)),highTime=Number(BigInt(latest.timestamp)),low=Math.max(0,high-10000000);
  const first=await rpc('eth_getBlockByNumber',['0x'+low.toString(16),false]);let lowTime=Number(BigInt(first.timestamp));
  if(highTime<cutoff)return {fromBlock:high+1,toBlock:high};
  if(lowTime>=cutoff){low=0;lowTime=0;}
  for(let step=0;high-low>1&&step<40;step++){
    const guess=Math.max(low+1,Math.min(high-1,step<12&&highTime>lowTime?Math.floor(low+(cutoff-lowTime)*(high-low)/(highTime-lowTime)):Math.floor((high+low)/2)));
    const block=await rpc('eth_getBlockByNumber',['0x'+guess.toString(16),false]),time=Number(BigInt(block.timestamp));
    if(time<cutoff){low=guess;lowTime=time;}else{high=guess;highTime=time;}
  }
  if(high-low>1)throw Error('Time window unavailable');
  return {fromBlock:high,toBlock:Number(BigInt(latest.number))};
}
export function sumPoolVolume(logs,pools){
  const totals=Object.fromEntries(pools.map(id=>[id,{amount0:'0',amount1:'0',swaps:0}]));
  for(const log of logs){
    const id=log.topics?.[1]?.toLowerCase(),row=totals[id];
    if(!row||log.address?.toLowerCase()!==POOL_MANAGER||log.topics?.[0]?.toLowerCase()!==SWAP_TOPIC)continue;
    if(!/^0x[0-9a-fA-F]{384}$/.test(log.data||''))throw Error('Invalid swap data');
    for(let i=0;i<2;i++){const raw=BigInt.asIntN(128,BigInt('0x'+log.data.slice(2+i*64,66+i*64)));row['amount'+i]=(BigInt(row['amount'+i])+(raw<0n?-raw:raw)).toString();}row.swaps++;
  }
  return totals;
}
