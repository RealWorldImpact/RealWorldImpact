import { priceMarketHoldings } from '../scripts/lp/market-discovery.js';
export default async function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  if(req.query.fresh!==undefined&&req.query.fresh!=='1')return res.status(400).json({error:'Invalid price refresh'});
  const fresh=req.query.fresh==='1';
  const addresses=typeof req.query.addresses==='string'?[...new Set(req.query.addresses.toLowerCase().split(','))]:[];
  if(!addresses.length||addresses.length>2||addresses.some(a=>!/^0x[0-9a-f]{40}$/.test(a)||/^0x0{40}$/.test(a)))return res.status(400).json({error:'Provide one or two token addresses'});
  const tokens=await priceMarketHoldings(addresses.map(address=>({address,logo:''})),{fresh});
  const prices=Object.fromEntries(tokens.map(t=>[t.address,t.priceUsd]));
  res.setHeader('Cache-Control',!fresh&&tokens.every(t=>t.priceUsd!==null)?'public, s-maxage=30':'no-store');
  return res.status(200).json({prices,chainId:4663,quotedAt:Object.fromEntries(tokens.map(t=>[t.address,t.priceUpdatedAt??null]))});
}
