import { parseUnits, formatUnits } from 'ethers';
import { TickMath, encodeSqrtRatioX96 } from '@uniswap/v3-sdk';
import { safeTokenLogo } from './wallet-tokens.js';
export function launchTerms(price){
  if(typeof price!=='string'||!/^\d{1,12}(?:\.\d{1,18})?$/.test(price.trim()))throw Error('Enter a positive starting price in RWI per token.');
  const units=parseUnits(price.trim(),18);if(units<=0n)throw Error('Starting price must be positive.');
  const tick=Math.floor(TickMath.getTickAtSqrtRatio(encodeSqrtRatioX96(units.toString(),(10n**18n).toString()))/200)*200;
  if(tick< -400000||tick>400000)throw Error('Choose a less extreme starting price.');
  const sqrt=BigInt(TickMath.getSqrtRatioAtTick(tick).toString());
  const actual=sqrt*sqrt*10n**18n/(1n<<192n);
  return {tick,price:formatUnits(actual,18),marketCap:formatUnits(actual*1000000000n,18)};
}
export function launchMetadata(input){
  const name=String(input.name||'').trim(),symbol=String(input.symbol||'').trim().toUpperCase();
  if(!name||name.length>32)throw Error('Enter a token name of 1–32 characters.');
  if(!/^[A-Z0-9]{1,10}$/.test(symbol))throw Error('Use 1–10 letters or numbers for the ticker.');
  const description=String(input.description||'').trim();if(description.length>256)throw Error('Keep the description under 257 characters.');
  const link=value=>{if(!value)return '';try{const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.href.length>512)throw Error();return url.href;}catch{throw Error('Links must be full HTTPS addresses.');}};
  const raw=String(input.logo||'').trim(),logo=raw?safeTokenLogo(raw):'';if(raw&&!logo)throw Error('Use an HTTPS or IPFS image URL.');
  return {name,symbol,logo,description,website:link(String(input.website||'').trim()),twitter:link(String(input.twitter||'').trim()),telegram:link(String(input.telegram||'').trim())};
}
