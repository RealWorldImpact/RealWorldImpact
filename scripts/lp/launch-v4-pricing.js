import { Contract, formatUnits } from 'ethers';
import { LAUNCH_V4_FACTORY } from './launch-v4-config.js';
import { LAUNCH_V4_ABI } from './launch-v4-contract.js';
export const LAUNCH_QUOTE_MAX_AGE=120000;
export function readLaunchQuote(q,terms,now=Date.now()){
  const at=Number(q.observedAt)*1000;
  if(!Number.isSafeInteger(at)||at>now||now-at>300000||q.lower<=0n||q.lower>q.price||q.price>q.upper||q.upper*10000n>q.lower*10200n||q.window<1800n||terms.referenceUsd!==q.price)throw Error('The verified RWI price is unavailable or stale. New launches resume when it is current.');
  return {quotedAt:now,observedAt:at,referenceUsd:q.price.toString(),rwiPriceUsd:formatUnits(q.price,18),phantomQuote:terms.phantom.toString(),initialTokens:terms.inventory.toString(),minRwiUsd:(q.price*9950n/10000n).toString(),maxRwiUsd:((q.price*10050n+9999n)/10000n).toString(),targetMarketCapUsd:'5000',graduationTargetUsd:'40000'};
}
export async function fetchLaunchQuote(rpc){
  if(!LAUNCH_V4_FACTORY)throw Error('Launches open after the verified price service and contracts are activated.');
  const c=new Contract(LAUNCH_V4_FACTORY,LAUNCH_V4_ABI,rpc),block=await rpc.getBlockNumber();
  const [q,terms]=await Promise.all([c.readOracle({blockTag:block}),c.previewTerms({blockTag:block})]);
  return readLaunchQuote(q,terms);
}
export function validateLaunchReview(review,current,now=Date.now()){
  if(!review||!current||!Number.isSafeInteger(review.quotedAt)||review.quotedAt>now||now-review.quotedAt>LAUNCH_QUOTE_MAX_AGE||!Number.isSafeInteger(current.quotedAt)||current.quotedAt>now||now-current.quotedAt>LAUNCH_QUOTE_MAX_AGE)throw Error('The launch review expired. Review the launch again.');
  if(review.targetMarketCapUsd!=='5000'||review.graduationTargetUsd!=='40000'||BigInt(current.referenceUsd)<BigInt(review.minRwiUsd)||BigInt(current.referenceUsd)>BigInt(review.maxRwiUsd))throw Error('RWI’s price moved outside your reviewed range. Review the launch again.');
}
