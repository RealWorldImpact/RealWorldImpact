import { BrowserProvider, ContractFactory, JsonRpcProvider, keccak256, getCreateAddress } from 'ethers';
import { walletCandidates } from '../../scripts/lp/wallet-providers.js';
import { LAUNCH_RUNTIME_HASH, LAUNCH_CREATION_HASH, LAUNCH_ABI } from '../../scripts/lp/launch-contract.js';
const $=id=>document.getElementById(id),providers=new Map();let selected=null,who=null,artifact=null;
const storageKey='rwi-launch-deployment-pending';
function pending(){const raw=localStorage.getItem(storageKey);if(!raw)return null;try{return JSON.parse(raw);}catch{throw Error('Saved deployment state is invalid. Check your wallet before deploying again.');}}
async function checkDeployment(){
 const entry=pending();if(!entry){status('No pending deployment is saved.');return;}
 const rpc=new JsonRpcProvider('https://rpc.mainnet.chain.robinhood.com',4663,{staticNetwork:true}),code=await rpc.getCode(entry.predicted);
 if(code==='0x'){
  const receipt=entry.hash?await rpc.getTransactionReceipt(entry.hash):null;
  if(receipt?.status===0||await rpc.getTransactionCount(entry.from,'latest')>entry.nonce){localStorage.removeItem(storageKey);$('deploy').disabled=!selected;status('The previous transaction failed or was replaced without deploying this contract. You can review a new deployment.');return;}
  throw Error('Deployment is not yet confirmed. Check your wallet. A second deployment has not been submitted.');
 }
 if(keccak256(code)!==LAUNCH_RUNTIME_HASH||entry.runtimeHash!==LAUNCH_RUNTIME_HASH)throw Error('The deployed code does not match this build. Do not activate it.');
 const record={factory:entry.predicted,transaction:entry.hash||'Check wallet receipt',runtimeHash:entry.runtimeHash};localStorage.setItem('rwi-launch-factory-deployment',JSON.stringify(record));$('result').textContent=JSON.stringify(record,null,2);$('result').hidden=false;$('deploy').disabled=true;status('Deployment verified. Send the factory address back in the chat to activate Launch.');
}
$('checkDeployment').onclick=()=>checkDeployment().catch(e=>status(e.shortMessage||e.message,true));
function status(message,error=false){$('status').textContent=message;$('status').className=error?'error':'';}
window.addEventListener('eip6963:announceProvider',event=>{const d=event.detail;if(d?.provider&&d.info?.uuid)providers.set(d.info.uuid,{provider:d.provider,name:d.info.name,rdns:d.info.rdns});});window.dispatchEvent(new Event('eip6963:requestProvider'));
$('connect').onclick=async()=>{try{const candidates=walletCandidates([...providers.values()],window.ethereum);if(!candidates.length)throw Error('Open this preview in a browser with your wallet installed.');$('choices').replaceChildren();for(const candidate of candidates){const button=document.createElement('button');button.textContent=candidate.name;button.onclick=async()=>{try{selected=candidate.provider;const accounts=await selected.request({method:'eth_requestAccounts'});if(!accounts?.[0])throw Error('No wallet selected.');who=accounts[0];const chain=await selected.request({method:'eth_chainId'});if(Number(chain)!==4663)throw Error('Switch your wallet to Robinhood Chain, then connect again.');artifact=await(await fetch('/assets/launch-contract.json')).json();$('wallet').textContent=who;$('deploy').disabled=Boolean(pending())||Boolean(localStorage.getItem('rwi-launch-factory-deployment'));$('choices').replaceChildren();status('Ready. Deployment costs network gas only and does not launch a token.');}catch(e){status(e.shortMessage||e.message,true);}};$('choices').append(button);}}catch(e){status(e.message,true);}};
$('deploy').onclick=async()=>{if(!selected||!who||!artifact)return;$('deploy').disabled=true;try{if(pending()||localStorage.getItem('rwi-launch-factory-deployment'))throw Error('A deployment is already saved. Use Check deployment status.');
 const chain=await selected.request({method:'eth_chainId'}),accounts=await selected.request({method:'eth_accounts'});if(Number(chain)!==4663||accounts[0]?.toLowerCase()!==who.toLowerCase())throw Error('Wallet or network changed. Connect again.');
 if(keccak256(artifact.bytecode)!==LAUNCH_CREATION_HASH||artifact.runtimeHash!==LAUNCH_RUNTIME_HASH)throw Error('The deployment file does not match the reviewed build. Reload the setup page.');
 const wallet=new BrowserProvider(selected,'any'),signer=await wallet.getSigner(who),factory=new ContractFactory(LAUNCH_ABI,artifact.bytecode,signer),request=await factory.getDeployTransaction();
 const gas=await signer.estimateGas(request);status('Confirm contract deployment in your wallet. Review its network gas estimate.');
 const finalChain=await selected.request({method:'eth_chainId'}),finalAccounts=await selected.request({method:'eth_accounts'});if(Number(finalChain)!==4663||finalAccounts[0]?.toLowerCase()!==who.toLowerCase())throw Error('Wallet changed. Connect again.');
 const nonce=await signer.getNonce('pending'),attempt={predicted:getCreateAddress({from:who,nonce}),from:who,nonce,runtimeHash:artifact.runtimeHash};localStorage.setItem(storageKey,JSON.stringify(attempt));
 const tx=await signer.sendTransaction({...request,chainId:4663,value:0n,nonce,gasLimit:gas*120n/100n});attempt.hash=tx.hash;localStorage.setItem(storageKey,JSON.stringify(attempt));status('Deployment submitted. Waiting for confirmation…');
 const receipt=await tx.wait(1);if(receipt.status!==1||!receipt.contractAddress)throw Error('Deployment did not confirm successfully.');
 const rpc=new JsonRpcProvider('https://rpc.mainnet.chain.robinhood.com',4663,{staticNetwork:true});if(keccak256(await rpc.getCode(receipt.contractAddress))!==artifact.runtimeHash)throw Error('The deployed code does not match the reviewed build. Do not activate it.');
 const record={factory:receipt.contractAddress,block:receipt.blockNumber,transaction:tx.hash,runtimeHash:artifact.runtimeHash};localStorage.setItem('rwi-launch-factory-deployment',JSON.stringify(record));$('result').textContent=JSON.stringify(record,null,2);$('result').hidden=false;status('Factory deployed and code verified. Send this factory address back in the chat to activate the Launch tab.');
 }catch(e){if(e.code===4001||e.code==='ACTION_REJECTED'||e.receipt?.status===0)localStorage.removeItem(storageKey);status(e.shortMessage||e.message,true);$('deploy').disabled=Boolean(localStorage.getItem(storageKey))||Boolean(localStorage.getItem('rwi-launch-factory-deployment'));}};
