import { normalizePortfolio } from '../scripts/lp/wallet-tokens.js';

export default async function handler(req,res){
  res.setHeader('Cache-Control','private, no-store');
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  const address=typeof req.query.address==='string'?req.query.address.toLowerCase():'';
  if(!/^0x[0-9a-f]{40}$/.test(address))return res.status(400).json({error:'Invalid wallet address'});
  try{
    const upstream=await fetch('https://balancesapi.ponsfamily.com/v1/portfolio/'+address+'?limit=200',{headers:{accept:'application/json'},signal:AbortSignal.timeout(10000)});
    if(!upstream.ok)return res.status(upstream.status===429?429:502).json({error:'Wallet token discovery is temporarily unavailable. You can still paste a token contract.'});
    const body=await upstream.json();
    if(typeof body.wallet!=='string'||body.wallet.toLowerCase()!==address)throw Error('Portfolio wallet mismatch');
    return res.status(200).json({...normalizePortfolio(body),updatedAt:new Date().toISOString()});
  }catch{return res.status(502).json({error:'Wallet token discovery is temporarily unavailable. You can still paste a token contract.'});}
}
