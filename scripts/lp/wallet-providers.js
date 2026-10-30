export function walletCandidates(announced,legacy){
  const candidates=[],seen=new Set();
  // Prefer EIP-6963 providers; legacy injection is a fallback, not a second list.
  for(const entry of announced){
    if(!entry?.provider||typeof entry.provider.request!=='function'||seen.has(entry.provider))continue;
    seen.add(entry.provider);candidates.push(entry);
  }
  if(candidates.length)return candidates;
  const providers=Array.isArray(legacy?.providers)&&legacy.providers.length?legacy.providers:[legacy];
  for(const provider of providers){
    if(!provider||typeof provider.request!=='function'||seen.has(provider))continue;
    seen.add(provider);candidates.push({name:provider.isRabby?'Rabby':provider.isCoinbaseWallet?'Coinbase Wallet':provider.isBraveWallet?'Brave Wallet':provider.isMetaMask?'MetaMask':'Browser wallet',provider});
  }
  return candidates;
}
