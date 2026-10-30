import { normalizePortfolio } from '../scripts/lp/wallet-tokens.js';
import { discoverMarketHoldings } from '../scripts/lp/market-discovery.js';

async function portfolio(address){
  const upstream=await fetch('https://balancesapi.ponsfamily.com/v1/portfolio/'+address+'?limit=200',{headers:{accept:'application/json'},signal:AbortSignal.timeout(10000)});
  if(!upstream.ok)throw Object.assign(Error('Portfolio unavailable'),{status:upstream.status});
  const body=await upstream.json();
  if(typeof body.wallet!=='string'||body.wallet.toLowerCase()!==address)throw Error('Portfolio wallet mismatch');
  return normalizePortfolio(body);
}

export default async function handler(req,res){
  res.setHeader('Cache-Control','private, no-store');
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  const address=typeof req.query.address==='string'?req.query.address.toLowerCase():'';
  if(!/^0x[0-9a-f]{40}$/.test(address))return res.status(400).json({error:'Invalid wallet address'});
  try{
    const [pons,market]=await Promise.allSettled([portfolio(address),discoverMarketHoldings(address)]);
    if(pons.status==='rejected'&&market.status==='rejected')return res.status(pons.reason?.status===429?429:502).json({error:'Wallet token discovery is temporarily unavailable. You can still paste a token contract.'});
    const tokens=new Map();
    for(const token of market.status==='fulfilled'?market.value.tokens:[])tokens.set(token.address,token);
    for(const token of pons.status==='fulfilled'?pons.value.tokens:[]){
      const extra=tokens.get(token.address);
      tokens.set(token.address,{...token,priceUsd:token.priceUsd??extra?.priceUsd??null,logo:token.logo||extra?.logo||''});
    }
    tokens.delete('0xda2598c976e62e7e15dcca75169b404712e48b04');
    return res.status(200).json({tokens:[...tokens.values()],partial:true,sources:{pons:pons.status==='fulfilled',uniswapMarkets:market.status==='fulfilled'},updatedAt:new Date().toISOString()});
  }catch{return res.status(502).json({error:'Wallet token discovery is temporarily unavailable. You can still paste a token contract.'});}
}
