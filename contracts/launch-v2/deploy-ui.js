import { BrowserProvider, Contract, ContractFactory, JsonRpcProvider, keccak256, getCreateAddress, getCreate2Address, toBeHex } from 'ethers';
import { walletCandidates } from '../../scripts/lp/wallet-providers.js';
import { LAUNCH_V2_ABI, LAUNCH_V2_RUNTIME_HASH, LAUNCH_V2_HOOK_RUNTIME_HASH, LAUNCH_V2_ROUTER_RUNTIME_HASH } from '../../scripts/lp/launch-v2-contract.js';
import { LAUNCH_V2_FACTORY } from '../../scripts/lp/launch-v2-config.js';
import { FACTORY_CREATION_HASH, HOOK_CREATION_HASH } from './build-hashes.js';
const $=id=>document.getElementById(id),providers=new Map(),storageKey='rwi-curve-v2-deployment-pending',completeKey='rwi-curve-v2-deployment';
const rpc=new JsonRpcProvider('https://rpc.mainnet.chain.robinhood.com',4663,{staticNetwork:true});
let provider,who,artifact,preparation,working=false;
function status(text,error=false){$('status').textContent=text;$('status').className=error?'error':'';}
function saved(){const value=localStorage.getItem(storageKey);if(!value)return null;try{return JSON.parse(value)}catch{throw Error('Saved deployment details are unreadable. Check your wallet history before continuing.');}}
function buttons(){ $('deploy').disabled=working||!preparation||!!saved()||!!localStorage.getItem(completeKey)||!!LAUNCH_V2_FACTORY; $('connect').disabled=working||!!LAUNCH_V2_FACTORY; }
async function checkSession(){const [chain,accounts]=await Promise.all([provider.request({method:'eth_chainId'}),provider.request({method:'eth_accounts'})]);if(Number(chain)!==4663||accounts[0]?.toLowerCase()!==who?.toLowerCase())throw Error('Wallet or network changed. Connect the intended wallet on Robinhood Chain again.');}
async function prepare(){
  await checkSession();const wallet=new BrowserProvider(provider,'any'),signer=await wallet.getSigner(who),nonce=await signer.getNonce('pending');
  const predicted=getCreateAddress({from:who,nonce});status('Preparing the creator-fee hook address…');
  let n=0n,salt,hook;do{salt=toBeHex(n++,32);hook=getCreate2Address(predicted,salt,HOOK_CREATION_HASH);if(n%512n===0n)await new Promise(resolve=>setTimeout(resolve,0));}while((BigInt(hook)&0x3fffn)!==0x20ccn);
  const factory=new ContractFactory(LAUNCH_V2_ABI,artifact.factory.bytecode,signer),request=await factory.getDeployTransaction(salt);
  const gas=await signer.estimateGas({...request,value:0n,nonce});await checkSession();if(await signer.getNonce('pending')!==nonce)throw Error('Your wallet transaction count changed. Connect again to prepare a fresh deployment.');
  preparation={nonce,predicted,hook,salt,request,gas};$('addresses').textContent='Factory: '+predicted+'\nCreator-fee hook: '+hook;
  status('Ready. Review the terms, then deploy through your wallet. This creates the contracts; it does not launch a token.');
}
async function verify(entry){
  const code=await rpc.getCode(entry.predicted);if(code==='0x')return null;
  if(entry.runtimeHash!==LAUNCH_V2_RUNTIME_HASH||keccak256(code)!==LAUNCH_V2_RUNTIME_HASH)throw Error('The deployed factory does not match this build. Do not activate it.');
  const f=new Contract(entry.predicted,LAUNCH_V2_ABI,rpc),[hook,router]=await Promise.all([f.hook(),f.router()]);
  if(hook.toLowerCase()!==entry.hook.toLowerCase())throw Error('The hook address differs from the prepared deployment.');
  const [hc,rc]=await Promise.all([rpc.getCode(hook),rpc.getCode(router)]);
  if(keccak256(hc)!==LAUNCH_V2_HOOK_RUNTIME_HASH||keccak256(rc)!==LAUNCH_V2_ROUTER_RUNTIME_HASH)throw Error('The deployed hook or router differs from this build.');
  for(const address of [hook,router])if((await new Contract(address,['function factory() view returns(address)'],rpc).factory()).toLowerCase()!==entry.predicted.toLowerCase())throw Error('A deployed contract points to a different factory.');
  const receipt=entry.hash?await rpc.getTransactionReceipt(entry.hash):null;
  const result={version:2,factory:entry.predicted,hook,router,block:receipt?.blockNumber??null,transaction:entry.hash??null,runtimeHash:LAUNCH_V2_RUNTIME_HASH};
  localStorage.setItem(completeKey,JSON.stringify(result));$('result').textContent=JSON.stringify(result,null,2);$('result').hidden=false;status('Deployment and all three contracts verified. Send these details in the chat so Launch can be activated.');return result;
}
$('checkDeployment').onclick=async()=>{working=true;buttons();try{const entry=saved();if(!entry)throw Error('No deployment attempt is saved in this browser.');if(await verify(entry))return;const receipt=entry.hash?await rpc.getTransactionReceipt(entry.hash):null;if(receipt?.status===0||await rpc.getTransactionCount(entry.from,'latest')>entry.nonce){localStorage.removeItem(storageKey);preparation=null;status('The previous transaction failed or was replaced. Connect again to prepare another deployment.');}else status('The transaction is still pending or was not submitted. Check your wallet history. No duplicate deployment has been sent.');}catch(e){status(e.shortMessage||e.message,true)}finally{working=false;buttons()}};
window.addEventListener('eip6963:announceProvider',event=>{const d=event.detail;if(d?.provider&&d.info?.uuid)providers.set(d.info.uuid,{provider:d.provider,name:d.info.name,rdns:d.info.rdns});});window.dispatchEvent(new Event('eip6963:requestProvider'));
$('connect').onclick=()=>{try{const choices=walletCandidates([...providers.values()],window.ethereum);if(!choices.length)throw Error('Open this page in a browser with your wallet installed.');$('choices').replaceChildren();for(const choice of choices){const button=document.createElement('button');button.className='secondary-button';button.textContent=choice.name;button.onclick=async()=>{working=true;preparation=null;buttons();try{provider=choice.provider;const accounts=await provider.request({method:'eth_requestAccounts'});who=accounts?.[0];if(!who)throw Error('No wallet was selected.');$('wallet').textContent=who;const response=await fetch('/assets/launch-v2-contract.json',{cache:'no-store'});if(!response.ok)throw Error('Deployment build unavailable.');artifact=await response.json();if(keccak256(artifact.factory.bytecode)!==FACTORY_CREATION_HASH||keccak256(artifact.hook.bytecode)!==HOOK_CREATION_HASH)throw Error('Deployment files do not match this build.');$('choices').replaceChildren();if(saved()||localStorage.getItem(completeKey)){status('A deployment is already saved. Use Check deployment status.');return;}await prepare();}catch(e){status(e.shortMessage||e.message,true)}finally{working=false;buttons()}};$('choices').append(button);}}catch(e){status(e.message,true)}};
$('deploy').onclick=async()=>{if(!preparation||working)return;working=true;buttons();try{
  if(saved()||localStorage.getItem(completeKey))throw Error('A deployment is already saved. Use Check deployment status.');
  await checkSession();const signer=await new BrowserProvider(provider,'any').getSigner(who);
  if(await signer.getNonce('pending')!==preparation.nonce){preparation=null;throw Error('Your wallet transaction count changed. Connect again before deploying.');}
  const entry={from:who,nonce:preparation.nonce,predicted:preparation.predicted,hook:preparation.hook,salt:preparation.salt,runtimeHash:LAUNCH_V2_RUNTIME_HASH};localStorage.setItem(storageKey,JSON.stringify(entry));
  status('Review deployment and gas in your wallet. The transaction sends 0 ETH to the new contract.');
  const tx=await signer.sendTransaction({...preparation.request,nonce:entry.nonce,chainId:4663,value:0n,gasLimit:preparation.gas*120n/100n});entry.hash=tx.hash;localStorage.setItem(storageKey,JSON.stringify(entry));
  status('Deployment submitted. Waiting for confirmation…');const receipt=await tx.wait(1);if(receipt.status!==1)throw Error('Deployment did not complete. Use Check deployment status.');if(!await verify(entry))throw Error('Code is not visible yet. Use Check deployment status.');
}catch(e){if(e.code===4001||e.code==='ACTION_REJECTED'){localStorage.removeItem(storageKey);preparation=null;}status(e.shortMessage||e.message,true)}finally{working=false;buttons()}};
if(LAUNCH_V2_FACTORY)status('This replacement is already activated at '+LAUNCH_V2_FACTORY+'. No deployment is needed.');buttons();
