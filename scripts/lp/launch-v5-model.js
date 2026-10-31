export const TOKEN_SUPPLY=10n**27n;
export function graduationProgress(record){
  if(record.phase===2)return 100;
  const inventory=BigInt(record.initialTokens),remaining=BigInt(record.tokenReserve),reserved=BigInt(record.reservedTokens),allocation=inventory-reserved;
  if(allocation<=0n||remaining<reserved||remaining>inventory)throw Error('Invalid launch allocation');
  return Number((inventory-remaining)*10000n/allocation)/100;
}
export function launchStage(t){return t.phase===2?'UNISWAP V4':t.ready?'READY TO GRADUATE':'BONDING CURVE';}
export function assertOnchainTerms(terms,record){
  if(BigInt(terms.referenceUsd)!==record.referenceUsd||BigInt(terms.phantomQuote)!==record.phantom||BigInt(terms.initialTokens)!==record.inventory||BigInt(terms.reservedTokens)!==record.reserved||BigInt(terms.referenceQuote)!==record.referenceQuote)throw Error('The launch terms changed. Review the updated launch.');
}
