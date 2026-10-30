import { volumeWindow, sumPoolVolume, SWAP_TOPIC, POOL_MANAGER } from '../scripts/lp/pool-volume.js';
let windowCache=null,windowPending=null;const cache=new Map();
async function rpc(method,params){const r=await fetch('https://rpc.mainnet.chain.robinhood.com',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error('RPC unavailable');const b=await r.json();if(b.error||b.result===undefined)throw Error('RPC unavailable');return b.result;}
export default async function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  const pools=typeof req.query.pools==='string'?[...new Set(req.query.pools.toLowerCase().split(','))].sort():[];
  if(!pools.length||pools.length>20||pools.some(p=>!/^0x[0-9a-f]{64}$/.test(p)))return res.status(400).json({error:'Invalid pools'});
  try{
    const missing=pools.filter(id=>!cache.has(id)||Date.now()-cache.get(id).at>60000);
    if(missing.length){
      if(!windowCache||Date.now()-windowCache.at>60000){if(!windowPending)windowPending=volumeWindow(rpc,Math.floor(Date.now()/1000)-86400).then(value=>{windowCache={...value,at:Date.now()};}).finally(()=>{windowPending=null;});await windowPending;}
      const logs=[];
      // The RPC permits larger windows when each indexed topic contains one value.
      for(let i=0;i<missing.length;i+=3){
        const groups=await Promise.all(missing.slice(i,i+3).map(async id=>{const rows=[];for(let from=windowCache.fromBlock;from<=windowCache.toBlock;from+=10000000)rows.push(...await rpc('eth_getLogs',[{address:POOL_MANAGER,fromBlock:'0x'+from.toString(16),toBlock:'0x'+Math.min(from+9999999,windowCache.toBlock).toString(16),topics:[SWAP_TOPIC,id]}]));return rows;}));logs.push(...groups.flat());
      }
      const totals=sumPoolVolume(logs,missing);for(const id of missing){if(cache.size>=500&&!cache.has(id))cache.delete(cache.keys().next().value);cache.set(id,{at:Date.now(),value:totals[id]});}
    }
    res.setHeader('Cache-Control','public, s-maxage=60');return res.status(200).json({pools:Object.fromEntries(pools.map(id=>[id,cache.get(id).value])),updatedAt:new Date().toISOString()});
  }catch{res.setHeader('Cache-Control','no-store');return res.status(502).json({error:'24-hour pool volume is temporarily unavailable'});}
}
