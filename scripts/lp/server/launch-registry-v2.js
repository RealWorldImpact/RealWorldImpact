import { Interface } from 'ethers';
import { LAUNCH_V2_FACTORY as LAUNCH_FACTORY } from '../launch-v2-config.js';
import { LAUNCH_V2_ABI } from '../launch-v2-contract.js';
const factory=new Interface(LAUNCH_V2_ABI),tokenInterface=new Interface(['function name() view returns(string)','function symbol() view returns(string)','function logo() view returns(string)','function description() view returns(string)']);
const saved=new Map();
async function batch(calls){
  if(calls.length>96){const chunks=[];for(let i=0;i<calls.length;i+=96)chunks.push(calls.slice(i,i+96));return (await Promise.all(chunks.map(batch))).flat();}
  const response=await fetch('https://rpc.mainnet.chain.robinhood.com',{method:'POST',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(10000),body:JSON.stringify(calls.map((c,id)=>({jsonrpc:'2.0',id,method:'eth_call',params:[{to:c.to,data:c.iface.encodeFunctionData(c.method,c.args||[])},'latest']})))});
  if(!response.ok)throw Error('Registry unavailable');const body=await response.json();if(!Array.isArray(body))throw Error('Invalid response');
  return calls.map((c,id)=>{const r=body.find(x=>x.id===id);if(r?.error||!/^0x[0-9a-fA-F]*$/.test(r?.result||''))throw Error('Incomplete response');return c.iface.decodeFunctionResult(c.method,r.result);});
}
export default async function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  const before=req.query.before;if(before!==undefined&&(typeof before!=='string'||!/^\d{1,10}$/.test(before)))return res.status(400).json({error:'Invalid launch cursor'});
  const creator=req.query.creator;if(creator!==undefined&&(typeof creator!=='string'||!/^0x[0-9a-fA-F]{40}$/.test(creator)))return res.status(400).json({error:'Invalid creator address'});
  const cacheKey=(creator?.toLowerCase()||'all')+':'+(before??'latest');
  if(!LAUNCH_FACTORY)return res.status(200).json({active:false,launches:[],total:0,next:null,version:2});
  try{
    const cached=before===undefined||creator?saved.get(cacheKey):null;if(cached&&Date.now()-cached.at<5000){res.setHeader('Cache-Control','public, s-maxage=5');return res.status(200).json(cached.body);}
    const [[rawCount]]=await batch([{to:LAUNCH_FACTORY,iface:factory,method:'launchCount'}]);const total=Number(rawCount);
    if(!Number.isSafeInteger(total)||total<0)throw Error('Invalid count');
    const end=Math.min(before===undefined?total:Number(before),total),start=Math.max(0,end-(creator?96:12));
    const indices=Array.from({length:end-start},(_,i)=>end-1-i);
    let tokens=indices.length?(await batch(indices.map(i=>({to:LAUNCH_FACTORY,iface:factory,method:'launchedTokens',args:[i]})))).map(x=>x[0].toLowerCase()):[];
    if(creator&&tokens.length){const records=await batch(tokens.map(to=>({to:LAUNCH_FACTORY,iface:factory,method:'launches',args:[to]})));tokens=tokens.filter((_,i)=>records[i].creator.toLowerCase()===creator.toLowerCase());}
    const values=tokens.length?await batch(tokens.flatMap(to=>[{to:LAUNCH_FACTORY,iface:factory,method:'launches',args:[to]},{to:LAUNCH_FACTORY,iface:factory,method:'rewardRwi',args:[to]},...['name','symbol','logo','description'].map(method=>({to,iface:tokenInterface,method}))])):[];
    const launches=tokens.map((address,i)=>{const [l,rewards,name,symbol,logo,description]=values.slice(i*6,i*6+6);if(![0n,1n,2n].includes(l.phase)||l.phantomQuote===0n)throw Error('Invalid launch');return {address,creator:l.creator.toLowerCase(),positionId:l.positionId.toString(),poolId:l.poolId,phantomQuote:l.phantomQuote.toString(),quoteReserve:l.quoteReserve.toString(),tokenReserve:l.tokenReserve.toString(),reservedTokens:l.reservedTokens.toString(),creatorTaxBps:Number(l.creatorTaxBps),phase:Number(l.phase),launchedAt:Number(l.launchedAt),rewardRwi:rewards[0].toString(),name:name[0].slice(0,32),symbol:symbol[0].slice(0,10),logo:logo[0],description:description[0].slice(0,256)};});
    const body={active:true,version:2,factory:LAUNCH_FACTORY,total,launches,next:start>0?String(start):null,updatedAt:new Date().toISOString()};
    if(saved.size>=100)saved.delete(saved.keys().next().value);saved.set(cacheKey,{at:Date.now(),body});res.setHeader('Cache-Control','public, s-maxage=5');return res.status(200).json(body);
  }catch{res.setHeader('Cache-Control','no-store');return res.status(502).json({error:'Launched tokens are temporarily unavailable. Retrying automatically.'});}
}
