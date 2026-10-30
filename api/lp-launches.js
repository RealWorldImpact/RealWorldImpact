import { LAUNCH_FACTORY } from '../scripts/lp/launch-config.js';
import { LAUNCH_SELECTORS } from '../scripts/lp/launch-contract.js';
import { decodeAbiString } from '../scripts/lp/token-logos.js';
import curveRegistry from '../scripts/lp/server/launch-registry-v2.js';
const RPC='https://rpc.mainnet.chain.robinhood.com';
let saved=null;
async function batch(calls){
  const response=await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(10000),body:JSON.stringify(calls.map((c,id)=>({jsonrpc:'2.0',id,method:'eth_call',params:[{to:c.to,data:c.data},'latest']})))});
  if(!response.ok)throw Error('Launch registry unavailable');const body=await response.json();if(!Array.isArray(body))throw Error('Invalid registry response');
  return calls.map((_,i)=>{const item=body.find(r=>r.id===i);if(item?.error||!/^0x[0-9a-fA-F]*$/.test(item?.result||''))throw Error('Incomplete registry response');return item.result;});
}
const word=n=>BigInt(n).toString(16).padStart(64,'0');
export default async function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  if(req.query.version==='2')return curveRegistry(req,res);
  if(req.query.version!==undefined&&req.query.version!=='1')return res.status(400).json({error:'Invalid launch version'});
  const raw=req.query.before;
  if(raw!==undefined&&(typeof raw!=='string'||!/^\d{1,10}$/.test(raw)))return res.status(400).json({error:'Invalid launch cursor'});
  if(!LAUNCH_FACTORY)return res.status(200).json({active:false,launches:[],total:0,next:null});
  try{
    if(raw===undefined&&saved&&Date.now()-saved.at<10000){res.setHeader('Cache-Control','public, s-maxage=10');return res.status(200).json(saved.body);}
    const [countRaw]=await batch([{to:LAUNCH_FACTORY,data:LAUNCH_SELECTORS.launchCount}]);const total=Number(BigInt(countRaw));
    if(!Number.isSafeInteger(total)||total<0)throw Error('Invalid launch count');
    const end=Math.min(raw===undefined?total:Number(raw),total),start=Math.max(0,end-12);
    const indices=Array.from({length:end-start},(_,i)=>end-1-i);
    const tokens=indices.length?(await batch(indices.map(i=>({to:LAUNCH_FACTORY,data:LAUNCH_SELECTORS.launchedTokens+word(i)})))).map(raw=>'0x'+raw.slice(-40).toLowerCase()):[];
    if(tokens.some(a=>!/^0x[0-9a-f]{40}$/.test(a)))throw Error('Invalid registry token');
    const calls=tokens.flatMap(to=>[{to:LAUNCH_FACTORY,data:LAUNCH_SELECTORS.launches+to.slice(2).padStart(64,'0')},...['name','symbol','logo','description'].map(field=>({to,data:LAUNCH_SELECTORS[field]}))]);
    const values=calls.length?await batch(calls):[];
    const launches=tokens.map((address,i)=>{const row=values.slice(i*5,i*5+5),hex=row[0].slice(2);if(hex.length!==384)throw Error('Invalid launch record');const words=Array.from({length:6},(_,j)=>hex.slice(j*64,j*64+64));return {address,creator:'0x'+words[0].slice(-40).toLowerCase(),positionId:BigInt('0x'+words[1]).toString(),poolId:'0x'+words[2],startTick:Number(BigInt.asIntN(24,BigInt('0x'+words[3]))),launchedAt:Number(BigInt('0x'+words[5])),name:decodeAbiString(row[1]).slice(0,32),symbol:decodeAbiString(row[2]).slice(0,10),logo:decodeAbiString(row[3]),description:decodeAbiString(row[4]).slice(0,256)};});
    const body={active:true,factory:LAUNCH_FACTORY,total,launches,next:start>0?String(start):null,updatedAt:new Date().toISOString()};
    if(raw===undefined)saved={at:Date.now(),body};res.setHeader('Cache-Control','public, s-maxage=10');return res.status(200).json(body);
  }catch{res.setHeader('Cache-Control','no-store');return res.status(502).json({error:'Launched tokens are temporarily unavailable. Retrying automatically.'});}
}
