import { parseUnits, formatUnits } from 'ethers';
import { safeTokenLogo } from './wallet-tokens.js';
export const LAUNCH_TARGET_USD='5000',LAUNCH_SUPPLY=1000000000n;
export function launchTerms(rwiPriceUsd){
  if(typeof rwiPriceUsd!=='string'||!/^\d{1,18}(?:\.\d{1,36})?$/.test(rwiPriceUsd))throw Error('A current RWI USD price is required to set the $5,000 launch target.');
  const usd=parseUnits(rwiPriceUsd,36);if(usd<=0n)throw Error('The RWI USD price must be positive.');
  const phantom=5000n*10n**54n/usd;
  if(phantom<10n**12n||phantom>10n**33n)throw Error('The RWI price is outside the supported launch range.');
  const threshold=phantom*5n/2n,supply=LAUNCH_SUPPLY*10n**18n,reserved=supply*phantom/(phantom+threshold);
  return {phantomQuote:phantom.toString(),graduationThreshold:threshold.toString(),reservedTokens:reserved.toString(),price:formatUnits(phantom*10n**18n/supply,18),marketCapRwi:formatUnits(phantom,18),targetMarketCapUsd:LAUNCH_TARGET_USD,marketCapUsd:formatUnits(phantom*usd/10n**18n,36),graduationTargetUsd:formatUnits(threshold*usd/10n**18n,36),rwiPriceUsd};
}
export function creatorTax(value){const tax=Number(value);if(!['0','100','200','300'].includes(String(value))||!Number.isInteger(tax))throw Error('Choose no extra tax, 1%, 2%, or 3%.');return tax;}
export function launchMetadata(input){
  const name=String(input.name||'').trim(),symbol=String(input.symbol||'').trim().toUpperCase();
  if(!name||name.length>32)throw Error('Enter a token name of 1–32 characters.');
  if(!/^[A-Z0-9]{1,10}$/.test(symbol))throw Error('Use 1–10 letters or numbers for the ticker.');
  const description=String(input.description||'').trim();if(description.length>256)throw Error('Keep the description under 257 characters.');
  const link=value=>{if(!value)return '';try{const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.href.length>512)throw Error();return url.href;}catch{throw Error('Links must be full HTTPS addresses.');}};
  const raw=String(input.logo||'').trim(),logo=raw?safeTokenLogo(raw):'';if(raw&&!logo)throw Error('Use an HTTPS or IPFS image URL.');
  return {name,symbol,logo,description,website:link(String(input.website||'').trim()),twitter:link(String(input.twitter||'').trim()),telegram:link(String(input.telegram||'').trim())};
}
