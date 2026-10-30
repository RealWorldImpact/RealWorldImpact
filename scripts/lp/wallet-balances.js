import { Interface } from 'ethers';
const multicall=new Interface(['function aggregate3((address target,bool allowFailure,bytes callData)[] calls) view returns ((bool success,bytes returnData)[])']);
const erc20=new Interface(['function balanceOf(address) view returns(uint256)','function decimals() view returns(uint8)']);
const target='0xca11bde05977b3631167028862be2a173976ca11';
export async function readWalletHoldings(tokens,wallet,call){
  const batches=[];for(let i=0;i<tokens.length;i+=100)batches.push(tokens.slice(i,i+100));
  const results=await Promise.allSettled(batches.map(async batch=>{
    const calls=batch.flatMap(t=>[{target:t.address,allowFailure:true,callData:erc20.encodeFunctionData('balanceOf',[wallet])},{target:t.address,allowFailure:true,callData:erc20.encodeFunctionData('decimals')}]);
    const data=await call({to:target,data:multicall.encodeFunctionData('aggregate3',[calls])});
    const decoded=multicall.decodeFunctionResult('aggregate3',data)[0];
    if(decoded.length!==calls.length)throw Error('Invalid wallet balance response.');
    const rows=[];let failed=0;
    for(let i=0;i<batch.length;i++){
      try{
        if(!decoded[i*2].success)throw Error('Balance unavailable');
        const balance=erc20.decodeFunctionResult('balanceOf',decoded[i*2].returnData)[0];
        if(balance===0n)continue;
        if(!decoded[i*2+1].success)throw Error('Decimals unavailable');
        const decimals=Number(erc20.decodeFunctionResult('decimals',decoded[i*2+1].returnData)[0]);
        if(decimals>36)throw Error('Unsupported decimals');
        rows.push({...batch[i],decimals,balance:balance.toString()});
      }catch{failed++;}
    }
    return {rows,failed};
  }));
  if(results.length&&results.every(r=>r.status==='rejected'))throw Error('Wallet balances are temporarily unavailable. Try refreshing holdings.');
  return results.reduce((out,r,i)=>{if(r.status==='fulfilled'){out.rows.push(...r.value.rows);out.failed+=r.value.failed;}else out.failed+=batches[i].length;return out;},{rows:[],failed:0});
}
