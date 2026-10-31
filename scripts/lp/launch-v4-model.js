export const TOKEN_SUPPLY=10n**27n;
export const START_USD=5000n*10n**18n;
export const TARGET_USD=40000n*10n**18n;
export const MIN_QUOTE_USD=250001n*10n**16n;
export function graduationProgress(record){
  if(record.phase===2)return 100;
  if(record.fdvUsd==null||record.quoteUsd==null)return null;
  const cap=BigInt(record.fdvUsd)*10000n/TARGET_USD;
  const liquidity=BigInt(record.quoteUsd)*10000n/MIN_QUOTE_USD;
  return Number([cap,liquidity,10000n].reduce((a,b)=>a<b?a:b))/100;
}
export function launchStage(t){return t.phase===2?'UNISWAP V4':t.delayComplete?'READY TO GRADUATE':t.eligible?'LIQUIDITY READY':'BONDING CURVE';}
export function assertOnchainTerms(terms,record){
  if(BigInt(terms.referenceUsd)!==record.referenceUsd||BigInt(terms.phantomQuote)!==record.phantom||BigInt(terms.initialTokens)!==record.inventory)throw Error('The launch price changed. Review the updated launch.');
}
