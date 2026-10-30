import { Contract } from 'ethers';
import { launchTerms } from './launch-v3-model.js';
export { LAUNCH_RWI, LAUNCH_QUOTE_MAX_AGE } from './launch-pricing.js';
import { LAUNCH_RWI, LAUNCH_QUOTE_MAX_AGE } from './launch-pricing.js';
export function readLaunchQuote(body,totalSupply,now=Date.now()){
  const quotedAt=body?.quotedAt?.[LAUNCH_RWI];
  if(body?.chainId!==4663||!Number.isSafeInteger(quotedAt)||quotedAt>now+5000||now-quotedAt>LAUNCH_QUOTE_MAX_AGE)throw Error('The RWI price is unavailable or out of date. Launching resumes when a current price is available.');
  return {...launchTerms(body.prices?.[LAUNCH_RWI],totalSupply),quotedAt};
}
export async function fetchLaunchQuote(rpc,fresh=false){
  const [response,supply]=await Promise.all([fetch('/api/lp-token-prices?addresses='+LAUNCH_RWI+(fresh?'&fresh=1':''),{cache:'no-store',signal:AbortSignal.timeout(10000)}),new Contract(LAUNCH_RWI,['function totalSupply() view returns(uint256)'],rpc).totalSupply()]);
  if(!response.ok)throw Error('The RWI price is temporarily unavailable. Please try again shortly.');
  return readLaunchQuote(await response.json(),supply);
}
export function validateLaunchReview(review,current,now=Date.now()){
  if(!review||!Number.isSafeInteger(review.quotedAt)||now-review.quotedAt>LAUNCH_QUOTE_MAX_AGE||review.quotedAt>now+5000)throw Error('The launch price review expired. Review the launch again.');
  if(!current||!Number.isSafeInteger(current.quotedAt)||now-current.quotedAt>LAUNCH_QUOTE_MAX_AGE||current.quotedAt>now+5000||review.targetMarketCapUsd!=='5000'||review.graduationTargetUsd!=='50000'||['openingCapRwi','phantomQuote','initialTokens','reservedTokens','graduationQuote','rwiReserveCap'].some(k=>review[k]!==current[k]))throw Error('RWI’s price or supply changed. Review the updated launch before confirming.');
}
