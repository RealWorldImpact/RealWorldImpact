import {BrowserProvider,JsonRpcProvider,getCreateAddress,keccak256,formatEther} from 'ethers';
import {walletCandidates} from '../../scripts/lp/wallet-providers.js';
import build from '../../assets/vote-native-contract.json';
import {createDeploymentRecovery} from './deployment-storage.js';
const $=id=>document.getElementById(id),providers=new Map(),recovery=createDeploymentRecovery();
const rpc=new JsonRpcProvider('https://rpc.mainnet.chain.robinhood.com',4663,{staticNetwork:true});
let provider,who,ready,record,working=false,active=false,configChecked=false,storageReady=false;
function status(message,error=false){$('status').textContent=message;$('status').className=error?'error':'';}
function saved(){return record?.pending;}
function showRecovery(entry){if(entry?.hash){$('recovery').textContent='Deployment transaction: '+entry.hash;$('recovery').hidden=false;}}
async function refreshRecord(){record=await recovery.load();storageReady=true;showRecovery(saved());return record;}
function buttons(){$('deploy').disabled=working||!ready||!!saved()||!!record?.complete||active||!configChecked||!storageReady;$('connect').disabled=working||active||!configChecked||!storageReady;$('check').disabled=working;}
async function configuration(){
 const response=await fetch('/contracts/vote/deployment.json',{cache:'no-store'});if(!response.ok)throw Error('Deployment status unavailable.');
 const c=await response.json();if(c.version!==3||c.chainId!==4663||c.runtimeHash!==build.runtimeHash||!['active','awaiting_deployment'].includes(c.status))throw Error('Deployment status does not match this build.');
 active=c.status==='active'||!!c.address;configChecked=true;if(active)status('The voting contract is already deployed. No new deployment is needed.');return c;
}
async function session(){const [chain,accounts]=await Promise.all([provider.request({method:'eth_chainId'}),provider.request({method:'eth_accounts'})]);if(Number(chain)!==4663||accounts[0]?.toLowerCase()!==who?.toLowerCase())throw Error('Connect the intended wallet on Robinhood Chain.');}
async function prepare(){
 await session();const signer=await new BrowserProvider(provider,'any').getSigner(who),nonce=await signer.getNonce('pending');
 if(keccak256(build.bytecode)!==build.creationHash)throw Error('Build mismatch.');
 const gas=await signer.estimateGas({data:build.bytecode,value:0n,nonce}),gasLimit=(gas*120n+99n)/100n;
 const [fees,balance]=await Promise.all([rpc.getFeeData(),rpc.getBalance(who)]),price=fees.maxFeePerGas||fees.gasPrice;
 if(price&&balance<gasLimit*price)throw Error('This wallet needs ETH for deployment gas. No RWI is required.');
 await session();if(await signer.getNonce('pending')!==nonce)throw Error('Wallet transaction count changed. Connect again.');
 ready={nonce,predicted:getCreateAddress({from:who,nonce}),gasLimit};
 $('gas').textContent=price?formatEther(gasLimit*price)+' ETH estimated maximum at current gas pricing':'Review the gas estimate in your wallet';
 $('address').textContent=ready.predicted;status('Ready. Deploying creates one voting contract. Review the gas cost in your wallet.');
}
async function verify(entry){
 const code=await rpc.getCode(entry.predicted);
 if(code!=='0x'&&!entry.hash)throw Error('Code exists at this address. Share the creation transaction from your wallet history; do not deploy again.');
 if(!entry.hash)return null;
 const [tx,receipt]=await Promise.all([rpc.getTransaction(entry.hash),rpc.getTransactionReceipt(entry.hash)]);if(!receipt||!tx)return null;
 if(receipt.status!==1)return {failed:true};
 const block=await rpc.getBlock(receipt.blockNumber);
 if(tx.to!==null||tx.value!==0n||Number(tx.chainId)!==4663||tx.from.toLowerCase()!==entry.from.toLowerCase()||tx.nonce!==entry.nonce||tx.data!==build.bytecode
  ||receipt.contractAddress?.toLowerCase()!==entry.predicted.toLowerCase()||tx.blockHash!==receipt.blockHash||block?.hash!==receipt.blockHash||keccak256(code)!==build.runtimeHash)throw Error('Deployment verification failed. Share the transaction hash; do not deploy again.');
 const result={version:3,address:receipt.contractAddress,block:receipt.blockNumber,transaction:entry.hash,runtimeHash:build.runtimeHash};
 // Display a confirmed result even if storage fails after the transaction.
 // The pre-signature pending record still prevents another deployment.
 $('result').textContent=JSON.stringify(result,null,2);$('result').hidden=false;
 record={...record,complete:result};
 try{record=await recovery.complete(result);status('Deployment confirmed. Copy these details into the chat for source verification and activation.');}
 catch{status('Deployment confirmed. Copy these details now; the browser could not save the confirmation. Do not deploy again.');}
 return result;
}
window.addEventListener('eip6963:announceProvider',e=>{const d=e.detail;if(d?.provider&&d.info?.uuid)providers.set(d.info.uuid,{provider:d.provider,name:d.info.name,rdns:d.info.rdns});});window.dispatchEvent(new Event('eip6963:requestProvider'));
$('connect').onclick=()=>{try{
 const choices=walletCandidates([...providers.values()],window.ethereum);if(!choices.length)throw Error('Open this page in a browser with your wallet installed.');$('choices').replaceChildren();
 for(const choice of choices){const button=document.createElement('button');button.textContent=choice.name;button.onclick=async()=>{
  working=true;ready=null;buttons();try{await configuration();if(active)return;provider=choice.provider;who=(await provider.request({method:'eth_requestAccounts'}))?.[0];if(!who)throw Error('No wallet selected.');$('wallet').textContent=who;$('choices').replaceChildren();
   await refreshRecord();if(saved()||record.complete){status('A deployment attempt is saved. Check its status before continuing.');return;}await prepare();
  }catch(e){status(e.shortMessage||e.message,true)}finally{working=false;buttons();}};$('choices').append(button);}
 }catch(e){status(e.message,true)}};
$('deploy').onclick=async()=>{if(!ready||working||!storageReady)return;working=true;buttons();let entry,claimed=false,requested=false;try{
 await configuration();if(active)return;await refreshRecord();if(saved()||record.complete)throw Error('A deployment attempt already exists. Check its status.');await session();
 const signer=await new BrowserProvider(provider,'any').getSigner(who);if(await signer.getNonce('pending')!==ready.nonce){ready=null;throw Error('Wallet transaction count changed. Connect again.');}
 entry={from:who,nonce:ready.nonce,predicted:ready.predicted};record=await recovery.claim(entry);claimed=true;
 await session();
 status('Review deployment in your wallet. Only network gas is paid.');
 requested=true;const tx=await signer.sendTransaction({data:build.bytecode,chainId:4663,value:0n,nonce:ready.nonce,gasLimit:ready.gasLimit});entry.hash=tx.hash;record.pending={...entry};showRecovery(entry);
 try{record=await recovery.submitted(entry);status('Submitted. Waiting for confirmation…');}
 catch{status('Submitted. Keep the transaction hash below; the browser could not save it. Waiting for confirmation…');}
 await tx.wait(1);const result=await verify(entry);if(!result||result.failed)throw Error('Deployment is not confirmed. Check its status.');
 }catch(e){
  if(claimed&&!entry.hash&&(!requested||e.code===4001||e.code==='ACTION_REJECTED')){ready=null;try{record=await recovery.clear(entry);}catch{status('No deployment was approved, but the saved attempt could not be cleared. Check its status before continuing.',true);return;}}
  status(e.shortMessage||e.message,true);
 }finally{working=false;buttons();}};
$('check').onclick=async()=>{working=true;buttons();try{
 // Preserve an in-memory hash if its durable update failed after broadcast.
 const remembered=saved();await refreshRecord();const entry=saved();if(entry&&remembered?.hash&&entry.from===remembered.from&&entry.nonce===remembered.nonce&&entry.predicted===remembered.predicted&&!entry.hash)entry.hash=remembered.hash;
 if(!entry){if(record.complete){$('result').textContent=JSON.stringify(record.complete,null,2);$('result').hidden=false;status('Previously confirmed deployment. Share these details for verification; do not deploy again.');return;}throw Error('No deployment attempt is saved in this browser.');}
 const result=await verify(entry);if(result&&!result.failed)return;
 if(result?.failed){record=await recovery.clear(entry);ready=null;status('The deployment reverted. Connect again to prepare a new attempt.');}
 else status('No confirmed deployment found yet. Check wallet history and share any replacement transaction hash. A second deployment has not been sent.');
 }catch(e){status(e.shortMessage||e.message,true)}finally{working=false;buttons();}};
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText($('result').textContent);$('copy').textContent='Copied';}catch{status('Select and copy the deployment details below.');}};
buttons();Promise.all([configuration(),refreshRecord()]).then(()=>{if(!active)status(record.complete?'A completed deployment is saved. Check its status to display the details.':saved()?'A deployment attempt is saved. Check its status before continuing.':'Connect your wallet to estimate gas. Nothing is sent when you connect.');}).catch(e=>status(e.message,true)).finally(buttons);
