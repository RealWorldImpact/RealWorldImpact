import { launchTerms } from './launch-model.js';
export const LAUNCH_RWI='0xda2598c976e62e7e15dcca75169b404712e48b04';
export const LAUNCH_QUOTE_MAX_AGE=120000;
export function readLaunchQuote(body,now=Date.now()){
  const quotedAt=body?.quotedAt?.[LAUNCH_RWI];
  if(body?.chainId!==4663||!Number.isSafeInteger(quotedAt)||quotedAt>now+5000||now-quotedAt>LAUNCH_QUOTE_MAX_AGE)throw Error('The RWI price is unavailable or out of date. Launching will resume when a current price is available.');
  return {...launchTerms(body.prices?.[LAUNCH_RWI]),quotedAt};
}
export async function fetchLaunchQuote(fresh=false){
  const response=await fetch('/api/lp-token-prices?addresses='+LAUNCH_RWI+(fresh?'&fresh=1':''),{cache:'no-store',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('The RWI price is temporarily unavailable. Please try again shortly.');
  return readLaunchQuote(await response.json());
}
export function validateLaunchReview(review,current,now=Date.now()){
  if(!review||!Number.isSafeInteger(review.quotedAt)||now-review.quotedAt>LAUNCH_QUOTE_MAX_AGE||review.quotedAt>now+5000)throw Error('The launch price review expired. Review the $5,000 launch again.');
  if(!current||!Number.isSafeInteger(current.quotedAt)||current.quotedAt>now+5000||now-current.quotedAt>LAUNCH_QUOTE_MAX_AGE||review.phantomQuote!==current.phantomQuote||review.targetMarketCapUsd!=='5000')throw Error('RWI’s price changed. Review the updated $5,000 launch before confirming.');
}
