import catalog from './market-catalog.js';
import { safeTokenLogo } from './wallet-tokens.js';
const RPC='https://rpc.mainnet.chain.robinhood.com';
const prices=new Map();
const word=n=>BigInt(n).toString(16).padStart(64,'0');
export function balanceBatch(tokens,wallet){
  const calls=tokens.map(t=>t.address.slice(2).padStart(64,'0')+word(1)+word(96)+word(36)+('70a08231'+wallet.slice(2).padStart(64,'0')).padEnd(128,'0'));
  return '0x82ad56cb'+word(32)+word(calls.length)+calls.map((_,i)=>word(calls.length*32+i*192)).join('')+calls.join('');
}
export function readBalanceBatch(result,count){
  if(typeof result!=='string'||!/^0x[0-9a-fA-F]+$/.test(result))throw Error('Invalid multicall response');
  const data=result.slice(2),at=offset=>{if(!Number.isSafeInteger(offset)||offset<0||offset*2+64>data.length)throw Error('Invalid multicall offset');return BigInt('0x'+data.slice(offset*2,offset*2+64));};
  const root=Number(at(0)),length=Number(at(root));if(length!==count)throw Error('Invalid multicall length');
  return Array.from({length},(_,i)=>{const base=root+32+Number(at(root+32+i*32));if(at(base)!==1n)return null;const bytes=base+Number(at(base+32));return at(bytes)===32n?at(bytes+32):null;});
}
async function json(url,options={}){
  const response=await fetch(url,{...options,signal:AbortSignal.timeout(7000)});
  if(!response.ok)throw Error('Market discovery unavailable');
  return response.json();
}
async function priced(token){
  const saved=prices.get(token.address);
  if(saved&&Date.now()-saved.at<60000)return {...token,...saved.value};
  try{
    const body=await json('https://api.geckoterminal.com/api/v2/networks/robinhood/tokens/'+token.address);
    const a=body.data?.attributes;
    if(a?.address?.toLowerCase()!==token.address)throw Error('Market address mismatch');
    const price=String(a.price_usd??'');
    const value={priceUsd:/^\d{1,60}(?:\.\d{1,60})?$/.test(price)?price:null,logo:safeTokenLogo(a.image_url)||token.logo};
    if(prices.size>=500&&!prices.has(token.address))prices.delete(prices.keys().next().value);
    prices.set(token.address,{at:Date.now(),value});return {...token,...value};
  }catch{return {...token,priceUsd:null};}
}
export async function priceMarketHoldings(held){
  const tokens=[];
  for(let i=0;i<held.length;i+=3)tokens.push(...await Promise.all(held.slice(i,i+3).map(priced)));
  return tokens;
}
export async function discoverMarketHoldings(wallet,exclude=[],withPrices=true){
  const excluded=new Set(exclude),candidates=catalog.filter(t=>!excluded.has(t.address));
  const held=[];let failed=false;
  // Read balances only on Robinhood's RPC. Market data receives token addresses, never the wallet.
  for(let start=0;start<candidates.length;start+=100){
    const batch=candidates.slice(start,start+100);
    const body=await json(RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_call',params:[{to:'0xca11bde05977b3631167028862be2a173976ca11',data:balanceBatch(batch,wallet)},'latest']})});
    const balances=readBalanceBatch(body.result,batch.length);
    for(let id=0;id<batch.length;id++){
      if(balances[id]===null){failed=true;continue;}
      if(balances[id]>0n)held.push({...batch[id],logo:safeTokenLogo(batch[id].logo)});
    }
  }
  const tokens=withPrices?await priceMarketHoldings(held):held.map(t=>({...t,priceUsd:null}));
  return {tokens,failed};
}
