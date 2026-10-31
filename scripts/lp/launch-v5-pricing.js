import { Contract, formatUnits } from 'ethers';
import { LAUNCH_V5_FACTORY } from './launch-v5-config.js';
import { LAUNCH_V5_ABI } from './launch-v5-contract.js';
export const LAUNCH_QUOTE_MAX_AGE=120000;
export function readLaunchQuote(q,terms,block,now=Date.now()){
  const at=Number(q.ethUpdatedAt)*1000,marketAt=Number(block.timestamp)*1000;
  if(!Number.isSafeInteger(marketAt)||marketAt>now+30000||now-marketAt>300000||!Number.isSafeInteger(at)||at<=0||at>marketAt||marketAt-at>86400000||q.referenceUsd<=0n||terms.referenceUsd!==q.referenceUsd)throw Error('The opening market reference is unavailable or stale. Existing launches can still trade and graduate.');
  return {quotedAt:now,marketObservedAt:marketAt,ethUpdatedAt:at,referenceUsd:q.referenceUsd.toString(),rwiPriceUsd:formatUnits(q.referenceUsd,18),phantomQuote:terms.phantom.toString(),initialTokens:terms.inventory.toString(),reservedTokens:terms.reserved.toString(),referenceQuote:terms.referenceQuote.toString(),minRwiUsd:(q.referenceUsd*9950n/10000n).toString(),maxRwiUsd:((q.referenceUsd*10050n+9999n)/10000n).toString(),startingEstimateUsd:'5000',graduationEstimateUsd:'40000',graduationMode:'sellout'};
}
export async function fetchLaunchQuote(rpc){
  if(!LAUNCH_V5_FACTORY)throw Error('Launches open after the new contracts are activated.');
  const c=new Contract(LAUNCH_V5_FACTORY,LAUNCH_V5_ABI,rpc),block=await rpc.getBlock('latest');
  const [q,terms]=await Promise.all([c.openingQuote({blockTag:block.number}),c.previewTerms({blockTag:block.number})]);
  return readLaunchQuote(q,terms,block);
}
export function validateLaunchReview(review,current,now=Date.now()){
  if(!review||!current||!Number.isSafeInteger(review.quotedAt)||review.quotedAt>now||now-review.quotedAt>LAUNCH_QUOTE_MAX_AGE||!Number.isSafeInteger(current.quotedAt)||current.quotedAt>now||now-current.quotedAt>LAUNCH_QUOTE_MAX_AGE)throw Error('The launch review expired. Review the launch again.');
  if(review.startingEstimateUsd!=='5000'||review.graduationEstimateUsd!=='40000'||review.graduationMode!=='sellout'||BigInt(current.referenceUsd)<BigInt(review.minRwiUsd)||BigInt(current.referenceUsd)>BigInt(review.maxRwiUsd))throw Error('RWI’s price moved outside your reviewed range. Review the launch again.');
}
