import { id } from 'ethers';
const transfer=id('Transfer(address,address,uint256)');
export async function discoverPositionIds(rpc,manager,wallet,previous){
  const block=await rpc.getBlockNumber(),ids=new Set(previous?.ids||[]);
  const start=previous&&previous.block<=block?Math.max(0,previous.block-16):0;
  const ranges=[];for(let from=start;from<=block;from+=10000000)ranges.push([from,Math.min(from+9999999,block)]);
  let partial=false;
  for(let i=0;i<ranges.length;i+=3){
    const results=await Promise.allSettled(ranges.slice(i,i+3).map(([fromBlock,toBlock])=>rpc.getLogs({address:manager,fromBlock,toBlock,topics:[transfer,null,'0x'+wallet.slice(2).toLowerCase().padStart(64,'0')]})));
    for(const result of results){
      if(result.status==='rejected'){partial=true;continue;}
      for(const log of result.value){
        if(log.address?.toLowerCase()!==manager.toLowerCase()||log.topics?.length!==4||log.topics[0]?.toLowerCase()!==transfer||log.topics[2]?.toLowerCase()!=='0x'+wallet.slice(2).toLowerCase().padStart(64,'0')||!/^0x[0-9a-fA-F]{64}$/.test(log.topics[3]))continue;
        ids.add(BigInt(log.topics[3]).toString());
      }
    }
  }
  return {block,ids:[...ids],partial};
}
