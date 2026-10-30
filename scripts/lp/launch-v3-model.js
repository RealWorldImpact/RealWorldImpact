import { parseUnits, formatUnits } from 'ethers';
export const TOKEN_SUPPLY=10n**27n;
const ceilDiv=(a,b)=>(a+b-1n)/b;
export function integerSqrt(n){if(n<0n)throw Error('Negative square root');if(n<2n)return n;let x=n,y=(x+1n)/2n;while(y<x){x=y;y=(x+n/x)/2n;}return x;}
export function curveTerms(openingCapRwi,reserveCap){
  const opening=BigInt(openingCapRwi),cap=BigInt(reserveCap);
  if(opening<10n**12n||opening>10n**33n||cap<10n**12n||cap>10n**33n)throw Error('The RWI price or supply is outside the supported launch range.');
  const calculate=inventory=>{const phantom=ceilDiv(opening*inventory,TOKEN_SUPPLY),reserved=integerSqrt(inventory*inventory/10n);if(reserved===0n||reserved>=inventory)throw Error('Unsupported curve inventory.');return {phantomQuote:phantom,initialTokens:inventory,reservedTokens:reserved,graduationQuote:(inventory-reserved)*phantom/reserved+1n,rwiReserveCap:cap};};
  let t=calculate(TOKEN_SUPPLY);
  if(t.graduationQuote+10n>cap){
    const maxPhantom=(integerSqrt(10n*cap*cap)+cap)/9n,margin=(opening/TOKEN_SUPPLY+1n)*32n+100n;
    if(maxPhantom<=margin)throw Error('Unsupported reserve ceiling.');
    const inventory=(maxPhantom-margin)*TOKEN_SUPPLY/opening;if(inventory===0n||inventory>=TOKEN_SUPPLY)throw Error('Unsupported curve inventory.');
    t=calculate(inventory);if(t.graduationQuote+10n>cap)throw Error('The curve exceeds its reserve ceiling.');
  }
  return t;
}
export function launchTerms(rwiPriceUsd,rwiTotalSupply){
  if(typeof rwiPriceUsd!=='string'||!/^\d{1,18}(?:\.\d{1,36})?$/.test(rwiPriceUsd))throw Error('A current RWI USD price is required.');
  const usd=parseUnits(rwiPriceUsd,36);if(usd<=0n)throw Error('The RWI USD price must be positive.');
  const opening=5000n*10n**54n/usd,total=BigInt(rwiTotalSupply),t=curveTerms(opening,total/100n);
  const seed=t.reservedTokens*t.graduationQuote/(t.phantomQuote+t.graduationQuote),sold=t.initialTokens-t.reservedTokens,locked=TOKEN_SUPPLY-sold-seed;
  const percent=n=>formatUnits(n*10n**8n/TOKEN_SUPPLY,6);
  return {...Object.fromEntries(Object.entries(t).map(([k,v])=>[k,v.toString()])),openingCapRwi:opening.toString(),rwiTotalSupply:total.toString(),graduationThreshold:t.graduationQuote.toString(),targetMarketCapUsd:'5000',graduationTargetUsd:'50000',marketCapUsd:formatUnits(opening*usd/10n**18n,36),rwiPriceUsd,price:formatUnits(t.phantomQuote*10n**18n/t.initialTokens,18),netReserveUsd:formatUnits(t.graduationQuote*usd/10n**18n,36),poolLiquidityUsd:formatUnits(2n*t.graduationQuote*usd/10n**18n,36),soldTokens:sold.toString(),poolTokens:seed.toString(),lockedTokens:locked.toString(),soldPercent:percent(sold),poolPercent:percent(seed),lockedPercent:percent(locked)};
}
export function assertOnchainTerms(terms,record){for(const key of ['phantomQuote','initialTokens','reservedTokens','graduationQuote','rwiReserveCap'])if(BigInt(terms[key])!==record[key])throw Error('The launch allocation changed. Review the updated launch before confirming.');}
export function graduationProgress(record){const target=Number(record.graduationQuote??BigInt(record.phantomQuote)*5n/2n);return Number.isFinite(target)&&target>0?Math.max(0,Math.min(100,Number(record.quoteReserve)/target*100)):0;}
