import { validHash } from './transaction-history.js';
// EIP-5792: require atomic execution so approvals and the deposit succeed together.
export async function atomicSupport(provider,who,chain){
  try{
    const caps=await provider.request({method:'wallet_getCapabilities',params:[who,['0x'+chain.toString(16)]]});
    return ['supported','ready'].includes(caps?.['0x'+chain.toString(16)]?.atomic?.status);
  }catch{return false;}
}
const key=(who,chain)=>'rwi-lp-batch:'+chain+':'+who.toLowerCase();
export function pendingBatch(store,who,chain){
  const raw=store.getItem(key(who,chain));if(!raw)return null;
  let entry;try{entry=JSON.parse(raw);}catch{throw Error('Saved deposit status could not be read. Check your wallet before making another deposit.');}
  if(!entry||typeof entry.id!=='string'||!/^0x[0-9a-fA-F]{2,8192}$/.test(entry.id))throw Error('Saved deposit status is invalid. Check your wallet before making another deposit.');
  return entry;
}
async function waitBatch(provider,entry,chain,{sleep=ms=>new Promise(r=>setTimeout(r,ms)),attempts=90,onReceipt=()=>{}}={}){
  for(let i=0;i<attempts;i++){
    let result;
    try{result=await provider.request({method:'wallet_getCallsStatus',params:[entry.id]});}catch{
      throw Error('The wallet has not returned the deposit status. Check your wallet before trying again. Your pending request is saved.');
    }
    if(!result||Number(result.chainId)!==chain)throw Error('The wallet returned a different network. Check the pending deposit in your wallet.');
    if(result.id!==entry.id)throw Error('The wallet returned a different deposit ID. Check your wallet before retrying.');
    if(result.status>=400){const error=Error('The batched deposit failed. Check your wallet for details.');error.terminal=true;throw error;}
    if(result.status>=200&&result.status<300){
      if(result.atomic!==true||!Array.isArray(result.receipts)||!result.receipts.length||result.receipts.some(r=>!r||Number(r.status)!==1||!validHash(r.transactionHash)||!Array.isArray(r.logs)||r.logs.some(log=>!log||!/^0x[0-9a-fA-F]{40}$/.test(log.address)||!Array.isArray(log.topics)||log.topics.some(t=>!validHash(t))||typeof log.data!=='string'||!/^0x(?:[0-9a-fA-F]{2})*$/.test(log.data))))throw Error('The wallet could not verify the atomic deposit. Check your wallet before retrying.');
      for(const receipt of result.receipts)onReceipt(receipt);
      return {logs:result.receipts.flatMap(r=>r.logs||[])};
    }
    await sleep(2000);
  }
  throw Error('The deposit is still pending. Check your wallet; the saved request will be checked before another deposit is sent.');
}
export async function checkPendingBatch(provider,store,who,chain,options){
  const entry=pendingBatch(store,who,chain);if(!entry)return;
  try{await waitBatch(provider,entry,chain,options);store.removeItem(key(who,chain));}
  catch(error){if(error.terminal)store.removeItem(key(who,chain));throw error;}
  throw Error('Your previous deposit confirmed. Review your updated balances before making another deposit.');
}
export async function sendAtomicBatch(provider,store,who,chain,calls,{check=async()=>{},...options}={}){
  await checkPendingBatch(provider,store,who,chain,options);
  await check();
  const id='0x'+Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');
  // Persist before submitting, including when the wallet response is lost. Never retry a send automatically.
  let entry={id};store.setItem(key(who,chain),JSON.stringify(entry));
  let result;
  try{result=await provider.request({method:'wallet_sendCalls',params:[{version:'2.0.0',id,from:who,chainId:'0x'+chain.toString(16),atomicRequired:true,calls:calls.map(({to,data,value=0n})=>({to,data,value:'0x'+BigInt(value).toString(16)}))}]});}
  catch(error){
    if([4001,4100,-32601,-32602,5700,5710,5740,5750,5760].includes(Number(error.code)))store.removeItem(key(who,chain));
    throw Error(Number(error.code)===4001||Number(error.code)===5750?'Deposit cancelled in your wallet.':'The wallet could not complete the batched request. Check your wallet before retrying.');
  }
  if(result?.id!==id)throw Error('The wallet did not return the expected deposit ID. Check your wallet before trying again.');
  entry={id:result.id};store.setItem(key(who,chain),JSON.stringify(entry));
  try{const receipt=await waitBatch(provider,entry,chain,options);store.removeItem(key(who,chain));return receipt;}
  catch(error){if(error.terminal)store.removeItem(key(who,chain));throw error;}
}
