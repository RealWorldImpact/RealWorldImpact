import { Interface } from 'ethers';
import { LAUNCH_V4_FACTORY } from '../launch-v4-config.js';
import { LAUNCH_V4_ABI } from '../launch-v4-contract.js';
import { TARGET_USD, MIN_QUOTE_USD, TOKEN_SUPPLY } from '../launch-v4-model.js';
const factory=new Interface(LAUNCH_V4_ABI);
const metadata=new Interface(['function name() view returns(string)','function symbol() view returns(string)','function logo() view returns(string)','function description() view returns(string)','function website() view returns(string)','function twitter() view returns(string)','function telegram() view returns(string)']);
const fields=['name','symbol','logo','description','website','twitter','telegram'];
const RPC='https://rpc.mainnet.chain.robinhood.com',zero='0x'+'0'.repeat(40),saved=new Map();
export const validAddress=v=>typeof v==='string'&&/^0x[0-9a-fA-F]{40}$/.test(v)&&v.toLowerCase()!==zero;
async function rpc(method,params){
  const response=await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(10000),body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  if(!response.ok)throw Error('Registry unavailable');const b=await response.json();if(b.error||b.result===undefined)throw Error('Incomplete registry response');return b.result;
}
async function batch(calls,block){
  if(!calls.length)return [];
  if(calls.length>80){const out=[];for(let i=0;i<calls.length;i+=240){const chunks=[];for(let j=i;j<Math.min(i+240,calls.length);j+=80)chunks.push(batch(calls.slice(j,j+80),block));out.push(...(await Promise.all(chunks)).flat());}return out;}
  const response=await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(10000),body:JSON.stringify(calls.map((c,id)=>({jsonrpc:'2.0',id,method:'eth_call',params:[{to:c.to,data:c.iface.encodeFunctionData(c.method,c.args||[])},block]})))});
  if(!response.ok)throw Error('Registry unavailable');const body=await response.json();if(!Array.isArray(body))throw Error('Invalid registry response');
  return calls.map((c,id)=>{const r=body.find(x=>x.id===id);try{if(r?.error||!/^0x[0-9a-fA-F]*$/.test(r?.result||''))throw Error('Missing result');return c.iface.decodeFunctionResult(c.method,r.result);}catch(e){if(c.optional)return null;throw e;}});
}
const call=(method,args=[],optional=false)=>({to:LAUNCH_V4_FACTORY,iface:factory,method,args,optional});
export async function readLaunchPage({before,creator,token,limit=12,blockTag}={}){
  if(before!==undefined&&(typeof before!=='string'||!/^\d{1,10}$/.test(before)))throw Object.assign(Error('Invalid launch cursor'),{status:400});
  if(creator!==undefined&&!validAddress(creator)||token!==undefined&&!validAddress(token))throw Object.assign(Error('Invalid address'),{status:400});
  if(!Number.isInteger(limit)||limit<1||limit>96)throw Object.assign(Error('Invalid page size'),{status:400});
  if(!LAUNCH_V4_FACTORY)return {active:false,version:4,launches:[],total:0,next:null};
  const key=[before,creator?.toLowerCase(),token?.toLowerCase(),limit,blockTag].join(':');
  const cached=saved.get(key);if(cached&&Date.now()-cached.at<5000)return cached.body;
  // One block snapshot for count, balances, metadata, and price eligibility.
  const block=await rpc('eth_getBlockByNumber',[blockTag||'latest',false]);
  if(!/^0x[0-9a-f]+$/i.test(block?.number||'')||!/^0x[0-9a-f]{64}$/i.test(block?.hash||''))throw Error('Invalid block');
  const [[count],quote]=await batch([call('launchCount'),call('readOracle',[],true)],block.number);
  const total=Number(count);if(!Number.isSafeInteger(total)||total<0)throw Error('Invalid count');
  const end=Math.min(before===undefined?total:Number(before),total),start=Math.max(0,end-(creator?96:limit));
  const indices=Array.from({length:end-start},(_,i)=>end-1-i);
  let tokens=token?[token.toLowerCase()]:(await batch(indices.map(i=>call('launchedTokens',[i])),block.number)).map(x=>x[0].toLowerCase());
  let records=await batch(tokens.map(t=>call('launches',[t])),block.number);
  const selected=tokens.map((address,i)=>({address,l:records[i]})).filter(({l})=>l.creator.toLowerCase()!==zero&&(!creator||l.creator.toLowerCase()===creator.toLowerCase()));
  const values=await batch(selected.flatMap(({address})=>[call('rewardRwi',[address]),...fields.map(method=>({to:address,iface:metadata,method}))]),block.number);
  const timestamp=Number(BigInt(block.timestamp)),q=Math.abs(Date.now()/1000-timestamp)<=300?quote?.[0]:null;
  const launches=selected.map(({address,l},i)=>{
    if(![0n,2n].includes(l.phase)||l.phantomQuote===0n||l.tokenReserve===0n)throw Error('Invalid launch state');
    const row=values.slice(i*8,i*8+8),info=Object.fromEntries(fields.map((f,j)=>[f,row[j+1][0]]));
    let fdvUsd=null,quoteUsd=null,eligible=false,delayComplete=false;
    if(q&&l.phase===0n){fdvUsd=((l.phantomQuote+l.quoteReserve)*TOKEN_SUPPLY/l.tokenReserve)*q.lower/10n**18n;quoteUsd=l.quoteReserve*q.lower/10n**18n;eligible=fdvUsd>=TARGET_USD&&quoteUsd>=MIN_QUOTE_USD;delayComplete=eligible&&l.readySince!==0n&&BigInt(timestamp)>=l.readySince+300n&&q.observedAt>=l.readySince+300n;}
    return {version:4,address,...info,creator:l.creator.toLowerCase(),positionId:l.positionId.toString(),poolId:l.poolId,phantomQuote:l.phantomQuote.toString(),initialTokens:l.initialTokens.toString(),openingRwiUsd:l.openingRwiUsd.toString(),quoteReserve:l.quoteReserve.toString(),tokenReserve:l.tokenReserve.toString(),seededQuote:l.seededQuote.toString(),seededTokens:l.seededTokens.toString(),creatorTaxBps:Number(l.creatorTaxBps),phase:Number(l.phase),launchedAt:Number(l.launchedAt),readySince:Number(l.readySince),rewardRwi:row[0][0].toString(),fdvUsd:fdvUsd?.toString()??null,quoteUsd:quoteUsd?.toString()??null,eligible,delayComplete,priceObservedAt:q?Number(q.observedAt):null};
  });
  const body={active:true,version:4,chainId:4663,factory:LAUNCH_V4_FACTORY,total,launches,next:token?null:start>0?String(start):null,blockNumber:Number(BigInt(block.number)),blockHash:block.hash,updatedAt:new Date(timestamp*1000).toISOString()};
  if(saved.size>=100)saved.delete(saved.keys().next().value);saved.set(key,{at:Date.now(),body});return body;
}
export default async function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  try{const body=await readLaunchPage({before:req.query.before,creator:req.query.creator,token:req.query.token});res.setHeader('Cache-Control','public, max-age=0, s-maxage=5');return res.status(200).json(body);}
  catch(e){res.setHeader('Cache-Control','no-store');return res.status(e.status||502).json({error:e.status?e.message:'Launched tokens are temporarily unavailable. Retrying automatically.'});}
}
