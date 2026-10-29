import { JsonRpcProvider, BrowserProvider, Contract, getAddress, formatUnits, Interface } from 'ethers';
import * as P from './protocol.js';
import { sortHoldings, usdLabel } from './wallet-tokens.js';
import { tokenLogoCandidates } from './token-logos.js';

const $=id=>document.getElementById(id);
const rpc=new JsonRpcProvider('https://rpc.mainnet.chain.robinhood.com',P.CHAIN,{staticNetwork:true,cacheTimeout:-1});
const manager=new Contract(P.CONTRACTS.manager,P.MANAGER,rpc),stateView=new Contract(P.CONTRACTS.state,P.STATE,rpc);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short=s=>s.slice(0,6)+'…'+s.slice(-4);
const fmt=(n,d)=>{const s=formatUnits(n,d);return s.length>24?s.slice(0,24)+'…':s;};
const txLink=hash=>'https://robin.etherscan.io/tx/'+hash;
let injected=null,wallet=null,account=null,session=0,busy=false,loaded=null,proposal=null,verified=false,positions=new Map(),loadSeq=0;
let currentView='add';
let walletTokens=[],tokenRequest=0,tokenAbort=null,tokenListMessage='';
let pending=readStore('rwi-lp-transactions',[]);
const discovered=new Map();
function readStore(k,fallback){try{const v=JSON.parse(localStorage.getItem(k));return Array.isArray(v)?v:fallback;}catch{return fallback;}}
function saveStore(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch{}}
function idsKey(){return 'rwi-lp-positions-'+account?.toLowerCase();}
function remember(id){const ids=readStore(idsKey(),[]);if(!ids.includes(id))saveStore(idsKey(),[id,...ids].slice(0,100));}
function notice(msg,error=false){$('notice').textContent=msg;$('notice').className=error?'notice error':'notice';}
function failure(e){if(e.code===4001||e.code==='ACTION_REJECTED')return 'Request cancelled in your wallet.';return e.shortMessage||e.reason||e.message||'The request failed. Try refreshing the chain data.';}
function locked(v){busy=v;document.querySelectorAll('main input,main select,main button,#walletButton,#disconnect').forEach(el=>el.disabled=v);$('submitAction').disabled=v||!proposal;$('cancelReview').disabled=v;}
function clearProposal(){proposal=null;$('reviewDialog').close();}
function invalidate(){loadSeq++;loaded=null;clearProposal();$('poolStatus').textContent='Refresh pool data';$('poolPrice').textContent='—';$('poolId').textContent='—';$('poolLink').hidden=true;$('pairName').textContent='Token / RWI';$('poolBlock').textContent='Load to refresh chain data';}
function resetWallet(){session++;resetTokens();account=null;wallet=null;positions.clear();$('walletButton').textContent='Connect wallet';$('disconnect').hidden=true;$('walletStatus').textContent='Connect to see balances and your positions.';$('positionList').innerHTML='<div class="empty-state">Connect your wallet to load your liquidity positions.</div>';clearProposal();renderActivity();}
async function verifyContracts(){
  if(verified)return;
  const [chain,pool,permit]=await Promise.all([rpc.send('eth_chainId',[]),manager.poolManager(),manager.permit2()]);
  if(Number(chain)!==P.CHAIN||pool.toLowerCase()!==P.CONTRACTS.pool||permit.toLowerCase()!==P.CONTRACTS.permit)throw Error('The liquidity contracts do not match this network. Transactions are disabled.');
  verified=true;
}
async function metadata(address){
  address=getAddress(address.trim());if(address===P.ZERO)throw Error('Use an ERC-20 contract address. To pair ETH, use WETH.');
  const c=new Contract(address,P.ERC20,rpc);
  const [symbol,decimals,name]=await Promise.all([c.symbol(),c.decimals(),c.name().catch(()=>null)]);
  if(Number(decimals)>36)throw Error('This token has unsupported decimals.');
  return P.token(address,Number(decimals),String(symbol).slice(0,24),String(name||symbol).slice(0,80));
}
async function snapshot(k,tokens,initial){
  const block=await rpc.getBlockNumber(),id=P.poolId(k);
  const [slot,liq]=await Promise.all([stateView.getSlot0(id,{blockTag:block}),stateView.getLiquidity(id,{blockTag:block})]);
  return {key:k,tokens,id,slot,liquidity:liq,block,exists:slot[0]>0n,pool:slot[0]>0n||initial?P.buildPool(k,tokens,slot,liq,initial):null};
}
async function loadPool(){
  const seq=++loadSeq,epoch=session;loaded=null;if(currentView==='add')notice('Reading pool state from Robinhood Chain…');
  try{
    await verifyContracts();const other=await metadata($('tokenAddress').value);const fee=Number($('fee').value),key=P.pair(other,fee);
    const rwi=P.token(P.RWI,18,'RWI'),tokens=key.currency0.toLowerCase()===P.RWI?[rwi,other]:[other,rwi];
    const data=await snapshot(key,tokens);
    if(seq!==loadSeq||epoch!==session)return;
    loaded=data;showSelectedToken(walletTokens.find(t=>t.address===other.address.toLowerCase())||other);loadTokenLogo(other,seq,epoch);$('tokenAmountLabel').textContent=other.symbol+' budget';$('pairName').textContent=other.symbol+' / RWI';
    $('poolStatus').textContent=data.exists?'Initialized pool':'New pool';$('poolId').textContent=data.id;$('poolLink').href='https://app.uniswap.org/explore/pools/robinhood/'+data.id;$('poolLink').hidden=!data.exists;
    $('poolPrice').textContent=data.exists?data.pool.priceOf(other).toSignificant(8)+' RWI / '+other.symbol:'Set by your two initial deposits';
    $('poolBlock').textContent='Read at block '+data.block.toLocaleString();
    if(currentView==='add')notice(data.exists?'Pool loaded. Deposits use the live pool price.':'No pool exists for this token and fee tier. Your first deposit will initialize it.');
    if(account)await balances(data);
  }catch(e){if(seq===loadSeq)notice(failure(e),true);}
}
async function balances(data){
  const epoch=session,who=account;if(!who)return;
  const values=await Promise.all(data.tokens.map(t=>new Contract(t.address,P.ERC20,rpc).balanceOf(who)));
  if(epoch!==session||who!==account)return;
  $('walletStatus').textContent=values.map((n,i)=>fmt(n,data.tokens[i].decimals)+' '+data.tokens[i].symbol).join(' · ');
}

function showSelectedToken(token){
  const label=$('walletTokenLabel');if(!token){label.textContent='Choose a wallet token';return;}
  const candidates=tokenLogoCandidates(token),name=token.name||token.symbol;
  label.innerHTML='<span class="selected-token-avatar"><span class="token-monogram">'+esc(token.symbol.slice(0,2))+'</span><img class="selected-token-logo" alt="" referrerpolicy="no-referrer" hidden></span><span class="selected-token-copy"><strong>'+esc(token.symbol)+'</strong><span class="selected-token-name">'+esc(name)+'</span></span>';
  const image=label.querySelector('img');let index=0,timer;
  const next=()=>{
    clearTimeout(timer);if(!label.contains(image))return;
    image.hidden=true;label.querySelector('.token-monogram').hidden=false;
    if(index>=candidates.length)return;
    image.src=candidates[index++];timer=setTimeout(next,4000);
  };
  image.onload=()=>{clearTimeout(timer);if(!label.contains(image))return;image.hidden=false;label.querySelector('.token-monogram').hidden=true;};
  image.onerror=next;next();
}
async function loadTokenLogo(token,seq,epoch){
  try{
    const response=await fetch('/api/lp-token-logo?address='+token.address.toLowerCase(),{signal:AbortSignal.timeout(10000)});if(!response.ok)return;
    const body=await response.json();
    if(seq!==loadSeq||epoch!==session||$('tokenAddress').value.toLowerCase()!==token.address.toLowerCase()||body.address!==token.address.toLowerCase())return;
    const walletLogo=walletTokens.find(t=>t.address===token.address.toLowerCase())?.logo;
    if(Array.isArray(body.logos)&&body.logos.length)showSelectedToken({address:token.address,symbol:token.symbol,name:token.name,logo:walletLogo,logos:body.logos});
  }catch{}
}
function resetTokens(){
  tokenRequest++;tokenAbort?.abort();tokenAbort=null;walletTokens=[];tokenListMessage='';
  $('walletTokenStatus').textContent='Connect your wallet to see holdings, highest USD value first.';$('walletTokenList').innerHTML='';$('tokenListNote').textContent='';$('tokenDialog').close();
}
function renderWalletTokens(){
  const query=$('tokenSearch').value.trim().toLowerCase();
  const rows=walletTokens.filter(t=>[t.name,t.symbol,t.address].some(v=>v.toLowerCase().includes(query)));
  $('walletTokenList').innerHTML=rows.length?rows.map(t=>'<button type="button" class="wallet-token-option" data-wallet-token="'+t.address+'"><span class="token-left"><strong>'+esc(t.symbol)+'</strong><small>'+esc(t.name)+'</small><small>'+short(t.address)+'</small></span><span class="token-value">'+usdLabel(t.valueUsd)+'<small>'+esc(fmt(t.balance,t.decimals))+' '+esc(t.symbol)+'</small></span></button>').join(''):'<p class="help">'+esc(query?'No matching tokens.':tokenListMessage||'No supported ERC-20 holdings found. You can still enter a token contract.')+'</p>';
  $('tokenListNote').textContent=tokenListMessage;
}
async function loadWalletTokens(){
  const who=account,epoch=session,request=++tokenRequest;if(!who)return;
  tokenAbort?.abort();const controller=new AbortController();tokenAbort=controller;
  const active=()=>request===tokenRequest&&epoch===session&&who===account&&!controller.signal.aborted;
  walletTokens=[];tokenListMessage='Loading your wallet holdings…';$('walletTokenStatus').textContent=tokenListMessage;renderWalletTokens();
  try{
    if(Number(await injected.request({method:'eth_chainId'}))!==P.CHAIN)throw Error('Switch to Robinhood Chain to load your holdings.');
    const response=await fetch('/api/lp-wallet-tokens?address='+who.toLowerCase(),{cache:'no-store',signal:controller.signal});
    const body=await response.json();if(!response.ok)throw Error(body.error||'Wallet holdings are temporarily unavailable.');
    if(!Array.isArray(body.tokens))throw Error('Wallet holdings could not be read.');
    const rows=[];let failed=0;
    for(let i=0;i<body.tokens.length;i+=20){
      if(!active())return;
      const results=await Promise.allSettled(body.tokens.slice(i,i+20).map(async t=>{
        const c=new Contract(t.address,P.ERC20,rpc),balance=await c.balanceOf(who);
        const decimals=balance>0n?Number(await c.decimals()):t.decimals;
        if(!Number.isInteger(decimals)||decimals<0||decimals>36)throw Error('Unsupported token decimals.');
        return {...t,decimals,balance:balance.toString()};
      }));
      for(const r of results)if(r.status==='fulfilled')rows.push(r.value);else failed++;
    }
    if(!active())return;
    walletTokens=sortHoldings(rows);const unpriced=walletTokens.filter(t=>t.valueUsd===null).length;
    tokenListMessage=(body.partial||failed?'Some holdings could not be loaded; enter a contract for a missing token. ':'')+(unpriced?unpriced+' token'+(unpriced===1?' has':'s have')+' no current USD price and '+(unpriced===1?'appears':'appear')+' last. ':'')+'USD values are estimates. Updated '+new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})+'.';
    $('walletTokenStatus').textContent=walletTokens.length+' wallet token'+(walletTokens.length===1?'':'s')+' · sorted by value held in USD'+(body.partial||failed?' · partial list':'');
    renderWalletTokens();
  }catch(e){
    if(!active())return;tokenListMessage=failure(e)+' You can still enter a token contract.';$('walletTokenStatus').textContent=tokenListMessage;renderWalletTokens();
  }finally{if(active())tokenAbort=null;}
}

function walletCandidate(detail){if(detail?.provider&&detail?.info?.uuid)discovered.set(detail.info.uuid,{name:detail.info.name,provider:detail.provider});}
window.addEventListener('eip6963:announceProvider',e=>walletCandidate(e.detail));window.dispatchEvent(new Event('eip6963:requestProvider'));
async function chooseWallet(){
  if(account){await switchNetwork();return;}
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  const candidates=[...discovered.values()];
  for(const provider of window.ethereum?.providers||[window.ethereum])if(provider&&!candidates.some(x=>x.provider===provider))candidates.push({name:provider.isMetaMask?'MetaMask':'Browser wallet',provider});
  const list=$('walletChoices');list.innerHTML='';
  if(!candidates.length){list.innerHTML='<p>No browser wallet was detected. Open this page in your wallet’s browser or install an Ethereum-compatible wallet.</p>';}
  candidates.forEach(c=>{const b=document.createElement('button');b.className='secondary-button';b.textContent=c.name;b.onclick=()=>connect(c.provider);list.append(b);});
  $('walletDialog').showModal();
}
async function switchNetwork(){
  if(!injected)throw Error('Connect your wallet first.');
  try{await injected.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x1237'}]});}
  catch(e){if(e.code!==4902)throw e;await injected.request({method:'wallet_addEthereumChain',params:[{chainId:'0x1237',chainName:'Robinhood Chain',nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},rpcUrls:['https://rpc.mainnet.chain.robinhood.com'],blockExplorerUrls:['https://robin.etherscan.io']}]});}
  await syncWallet();
}
async function syncWallet(){
  const provider=injected;if(!provider)return;
  const epoch=++session;resetTokens();clearProposal();positions.clear();
  const [accounts,chain]=await Promise.all([provider.request({method:'eth_accounts'}),provider.request({method:'eth_chainId'})]);
  if(epoch!==session||provider!==injected)return;
  if(!accounts.length){resetWallet();return;}
  account=getAddress(accounts[0]);wallet=new BrowserProvider(provider,'any',{cacheTimeout:-1});
  $('walletButton').textContent=Number(chain)===P.CHAIN?short(account):'Switch network';$('disconnect').hidden=false;
  $('walletStatus').textContent=Number(chain)===P.CHAIN?'Connected on Robinhood Chain.':'Switch to Robinhood Chain to manage liquidity.';
  $('positionList').innerHTML='<div class="empty-state">Use “Refresh positions” or import a position ID below.</div>';
  renderActivity();
  if(Number(chain)!==P.CHAIN){tokenListMessage='Switch to Robinhood Chain to load your holdings.';$('walletTokenStatus').textContent=tokenListMessage;}
  if(Number(chain)===P.CHAIN){loadWalletTokens();if(loaded)await balances(loaded);}
}
let oldAccountListener,oldChainListener,oldDisconnectListener;
async function connect(provider){
  try{
    if(injected?.removeListener){injected.removeListener('accountsChanged',oldAccountListener);injected.removeListener('chainChanged',oldChainListener);injected.removeListener('disconnect',oldDisconnectListener);}
    injected=provider;await provider.request({method:'eth_requestAccounts'});
    oldAccountListener=()=>syncWallet().catch(e=>notice(failure(e),true));oldChainListener=oldAccountListener;oldDisconnectListener=()=>{resetWallet();notice('Wallet disconnected.');};
    provider.on?.('accountsChanged',oldAccountListener);provider.on?.('chainChanged',oldChainListener);provider.on?.('disconnect',oldDisconnectListener);
    $('walletDialog').close();await syncWallet();
  }catch(e){notice(failure(e),true);}
}
async function signerFor(who,epoch){
  if(!injected||!wallet||session!==epoch||account!==who)throw Error('Your wallet changed. Review the action again.');
  const [chain,accounts]=await Promise.all([injected.request({method:'eth_chainId'}),injected.request({method:'eth_accounts'})]);
  if(session!==epoch||Number(chain)!==P.CHAIN||accounts[0]?.toLowerCase()!==who.toLowerCase())throw Error('Wallet or network changed. Review the action again.');
  return wallet.getSigner(who);
}
function activity(entry){pending=[{account:account?.toLowerCase(),...entry,chain:P.CHAIN,time:new Date().toISOString()},...pending].slice(0,100);saveStore('rwi-lp-transactions',pending);renderActivity();}
function updateActivity(hash,status){const entry=pending.find(x=>x.hash===hash);if(entry){entry.status=status;saveStore('rwi-lp-transactions',pending);renderActivity();}}
function renderActivity(){
  const rows=pending.filter(x=>x.account===account?.toLowerCase());
  $('activityList').innerHTML=rows.length?rows.map(x=>'<div class="activity-row"><div><strong>'+esc(x.label)+'</strong><small>'+esc(x.status)+' · '+esc(new Date(x.time).toLocaleString())+'</small></div><a target="_blank" rel="noopener" href="'+txLink(x.hash)+'">'+short(x.hash)+' ↗</a></div>').join(''):'<div class="empty-state">Your submitted transactions will appear here. No sample activity.</div>';
}
async function send(signer,request,label,who,epoch){
  await signerFor(who,epoch);notice(label+': checking transaction…');
  await signer.provider.call({...request,from:who});
  const gas=await signer.estimateGas(request);await signerFor(who,epoch);
  notice(label+': approve the transaction in your wallet.');
  const tx=await signer.sendTransaction({...request,chainId:P.CHAIN,gasLimit:gas*120n/100n});activity({hash:tx.hash,label,status:'Pending',account:who.toLowerCase()});
  let receipt;
  try{receipt=await tx.wait(1);}catch(e){
    if(e.code==='TRANSACTION_REPLACED'&&e.receipt){updateActivity(tx.hash,e.cancelled?'Replaced / cancelled':'Replaced');activity({account:who.toLowerCase(),hash:e.receipt.hash,label:e.cancelled?'Cancelled transaction':label,status:e.receipt.status===1?'Confirmed':'Reverted'});if(e.cancelled)throw Error('Transaction cancelled in your wallet.');receipt=e.receipt;}
    else{updateActivity(tx.hash,e.receipt?'Reverted':'Pending — check explorer');throw e;}
  }
  if(receipt.status!==1){updateActivity(tx.hash,'Reverted');throw Error('The transaction reverted. No liquidity change was confirmed.');}
  updateActivity(receipt.hash,'Confirmed');await signerFor(who,epoch);return receipt;
}
async function approvals(p,signer){
  const expiration=Math.floor(Date.now()/1000)+1200;
  for(let i=0;i<2;i++){
    const t=p.position.pool['currency'+i],cap=p.caps[i],contract=new Contract(t.address,P.ERC20,rpc);
    const allowance=await contract.allowance(p.who,P.CONTRACTS.permit);
    if(allowance<cap){
      if(allowance>0n)await send(signer,{to:t.address,data:contract.interface.encodeFunctionData('approve',[P.CONTRACTS.permit,0n])},'Reset '+t.symbol+' allowance',p.who,p.epoch);
      await send(signer,{to:t.address,data:contract.interface.encodeFunctionData('approve',[P.CONTRACTS.permit,cap])},'Approve '+t.symbol+' to Permit2',p.who,p.epoch);
    }
    const permit=new Contract(P.CONTRACTS.permit,P.PERMIT,rpc),a=await permit.allowance(p.who,t.address,P.CONTRACTS.manager);
    if(a[0]<cap||a[1]<BigInt(Math.floor(Date.now()/1000)+600))await send(signer,{to:P.CONTRACTS.permit,data:permit.interface.encodeFunctionData('approve',[t.address,P.CONTRACTS.manager,cap,expiration])},'Authorize '+t.symbol+' for LP deposit',p.who,p.epoch);
  }
}
function showReview(p,rows){
  proposal=p;$('reviewTitle').textContent=p.label;$('reviewRows').innerHTML=rows.map(([a,b])=>'<dt>'+esc(a)+'</dt><dd>'+esc(b)+'</dd>').join('');
  $('approvalNote').hidden=p.kind!=='deposit';$('submitAction').textContent=p.kind==='deposit'?'Approve & deposit':'Confirm in wallet';$('submitAction').disabled=false;$('reviewDialog').showModal();
}
async function reviewDeposit(event){
  event?.preventDefault();locked(true);
  try{
    if(!account)throw Error('Connect your wallet first.');const who=account,epoch=session;await signerFor(who,epoch);await loadPool();
    if(!loaded)throw Error('Pool data could not be loaded.');const data=loaded;
    const other=data.tokens.find(t=>t.address.toLowerCase()!==P.RWI),r=P.amount($('rwiAmount').value,18),t=P.amount($('tokenAmount').value,other.decimals);
    const budgets=data.key.currency0.toLowerCase()===P.RWI?[r,t]:[t,r];
    const live=await snapshot(data.key,data.tokens,budgets),slip=Number($('slippage').value);
    const {position,caps}=P.makeDeposit(live.pool,budgets,slip);
    const balances=await Promise.all(data.tokens.map(t=>new Contract(t.address,P.ERC20,rpc).balanceOf(who)));
    if(balances.some((n,i)=>n<caps[i]))throw Error('Your wallet does not have enough tokens for this deposit.');
    await signerFor(who,epoch);
    const p={kind:'deposit',who,epoch,position,caps,live,slip,createdAt:Date.now(),label:live.exists?'Add liquidity':'Create pool & add liquidity'};
    showReview(p,[['Network','Robinhood Chain (4663)'],['Pair',other.symbol+' / RWI'],['Pool fee',(Number(data.key.fee)/10000)+'%'],['Range','Full range'],['Pool hooks','None'],['Pool ID',live.id],...caps.map((n,i)=>['Maximum '+data.tokens[i].symbol,formatUnits(n,data.tokens[i].decimals)]),['Slippage',(slip/100)+'%'],['Recipient',who],['Position Manager',P.CONTRACTS.manager],['Expiry','20 minutes after confirmation']]);
    notice('Review the deposit. Only your wallet can authorize it.');
  }catch(e){notice(failure(e),true);}finally{locked(false);}
}
async function readPosition(id){
  if(!/^\d+$/.test(id)||BigInt(id)<=0n)throw Error('Enter a valid position ID.');await verifyContracts();
  const who=account,epoch=session;if(!who)throw Error('Connect your wallet first.');
  const [owner,result,liquidity]=await Promise.all([manager.ownerOf(id),manager.getPoolAndPositionInfo(id),manager.getPositionLiquidity(id)]);
  if(owner.toLowerCase()!==who.toLowerCase())throw Error('This position is not owned by your connected wallet.');
  const raw=result[0],k={currency0:raw[0],currency1:raw[1],fee:Number(raw[2]),tickSpacing:Number(raw[3]),hooks:raw[4]};
  if(![k.currency0.toLowerCase(),k.currency1.toLowerCase()].includes(P.RWI))throw Error('This position is not paired with RWI.');
  if(k.hooks.toLowerCase()!==P.ZERO)throw Error('This position uses custom hooks. Manage it through its original venue. LP supports pools without hooks.');
  if(k.currency0===P.ZERO||k.currency1===P.ZERO)throw Error('Native ETH positions are not supported here. Use the original venue.');
  const tokens=await Promise.all([metadata(k.currency0),metadata(k.currency1)]),live=await snapshot(k,tokens),position=P.ownedPosition(live.pool,liquidity,result[1]);
  if(session!==epoch||account!==who)throw Error('Wallet changed. Refresh positions.');
  return {id,who,epoch,live,position,liquidity};
}
function renderPositions(){
  $('positionList').innerHTML=positions.size?[...positions.values()].map(p=>'<article class="position-card"><div class="position-title"><div><span class="eyebrow">POSITION '+esc(p.id)+'</span><h3>'+esc(p.live.tokens.map(t=>t.symbol).join(' / '))+'</h3></div><span class="pool-tag">'+(p.live.key.fee/10000)+'% fee</span></div><div class="position-amounts"><span>'+esc(p.position.amount0.toSignificant(8))+' '+esc(p.live.tokens[0].symbol)+'</span><span>'+esc(p.position.amount1.toSignificant(8))+' '+esc(p.live.tokens[1].symbol)+'</span></div><p class="small muted">Principal at the current price · fees excluded. Ticks '+p.position.tickLower+' to '+p.position.tickUpper+'.</p><div class="position-actions"><button class="secondary-button" data-id="'+p.id+'" data-action="remove" '+(p.liquidity===0n?'disabled':'')+'>Withdraw</button><button class="secondary-button" data-id="'+p.id+'" data-action="collect">Collect fees</button><a href="https://robin.etherscan.io/nft/'+P.CONTRACTS.manager+'/'+p.id+'" target="_blank" rel="noopener">View receipt ↗</a></div></article>').join(''):'<div class="empty-state">No supported RWI positions found in your saved IDs. Import another position below.</div>';
}
async function importPosition(){locked(true);try{const id=$('positionId').value.trim(),p=await readPosition(id);positions.set(id,p);remember(id);renderPositions();notice('Position '+id+' loaded from chain.');}catch(e){notice(failure(e),true);}finally{locked(false);}}
async function refreshPositions(){
  locked(true);try{
    if(!account)throw Error('Connect your wallet first.');const epoch=session,who=account;positions.clear();
    const ids=readStore(idsKey(),[]).filter(x=>/^\d+$/.test(x));
    // Indexer discovery is optional; onchain ownerOf and PoolKey remain authoritative.
    let indexerFailed=false;
    try{
      const r=await fetch('https://robinhoodchain.blockscout.com/api/v2/addresses/'+who+'/nft?type=ERC-721',{signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error();const j=await r.json();
      for(const x of j.items||[])if((x.token?.address_hash||x.token?.address||'').toLowerCase()===P.CONTRACTS.manager&&/^\d+$/.test(x.id||''))ids.push(String(x.id));
      if(j.next_page_params)indexerFailed=true;
    }catch{indexerFailed=true;}
    let skipped=0;
    for(const id of [...new Set(ids)].slice(0,100)){
      if(epoch!==session||who!==account)throw Error('Wallet changed. Refresh positions.');
      try{const p=await readPosition(id);positions.set(id,p);remember(id);}catch{skipped++;}
    }
    renderPositions();notice('Loaded '+positions.size+' supported positions.'+(indexerFailed?' Discovery is incomplete; import any missing position by its ID.':'')+(skipped?' Other, transferred, or unsupported positions were skipped.':''));
    for(const tx of pending.filter(x=>x.account===who.toLowerCase()&&x.status.startsWith('Pending')).slice(0,20)){const r=await rpc.getTransactionReceipt(tx.hash);if(r)updateActivity(tx.hash,r.status===1?'Confirmed':'Reverted');}
  }catch(e){notice(failure(e),true);}finally{locked(false);}
}
async function reviewPosition(id,kind){
  locked(true);try{
    const p=await readPosition(id),percentage=Number($('withdrawPercent').value),slip=Number($('slippage').value);await signerFor(p.who,p.epoch);
    if(kind==='remove'&&p.liquidity===0n)throw Error('This position has no remaining liquidity.');
    const rows=[['Position',id],['Network','Robinhood Chain (4663)'],['Recipient',p.who],['Pool ID',p.live.id]];
    if(kind==='remove'){
      const partial=new P.Position({pool:p.position.pool,liquidity:(p.liquidity*BigInt(percentage)/100n).toString(),tickLower:p.position.tickLower,tickUpper:p.position.tickUpper});
      if(BigInt(partial.liquidity.toString())===0n)throw Error('The selected withdrawal rounds to zero. Increase the percentage.');
      const mins=partial.burnAmountsWithSlippage(new P.Percent(slip,10000));
      rows.push(['Withdraw',percentage+'%'],...['amount0','amount1'].map((k,i)=>['Minimum '+p.live.tokens[i].symbol,formatUnits(mins[k].toString(),p.live.tokens[i].decimals)]),['Slippage',slip/100+'%']);
    }else rows.push(['Action','Collect accrued fees to your wallet'],['Principal','Unchanged']);
    showReview({...p,kind,percentage,slip,createdAt:Date.now(),label:kind==='remove'?'Withdraw liquidity':'Collect fees'},rows);
  }catch(e){notice(failure(e),true);}finally{locked(false);}
}
async function execute(){
  const p=proposal;if(!p||busy)return;locked(true);
  try{
    if(Date.now()-p.createdAt>300000)throw Error('This review expired. Refresh and review the action again.');
    const signer=await signerFor(p.who,p.epoch);await verifyContracts();
    let deadline=Math.floor(Date.now()/1000)+1200;
    let call;
    if(p.kind==='deposit'){
      await approvals(p,signer);
      const fresh=await snapshot(p.live.key,p.live.tokens);
      if(fresh.exists!==p.live.exists)throw Error('The pool changed while approvals were pending. Review the deposit again.');
      deadline=Math.floor(Date.now()/1000)+1200;
      call=P.addCall(p.position,p.who,p.slip,deadline,!p.live.exists);
    }else{
      const fresh=await readPosition(p.id);
      if(fresh.liquidity!==p.liquidity)throw Error('Your position changed. Review the action again.');
      call=p.kind==='remove'?P.removeCall(p.position,p.id,p.percentage,p.slip,deadline):P.collectCall(p.position,p.id,p.who,deadline);
    }
    const receipt=await send(signer,{to:P.CONTRACTS.manager,data:call.calldata,value:BigInt(call.value)},p.label,p.who,p.epoch);
    if(p.kind==='deposit'){
      const iface=new Interface(P.MANAGER);
      for(const log of receipt.logs)if(log.address.toLowerCase()===P.CONTRACTS.manager){try{const e=iface.parseLog(log);if(e?.name==='Transfer'&&e.args.from===P.ZERO&&e.args.to.toLowerCase()===p.who.toLowerCase())remember(e.args.tokenId.toString());}catch{}}
    }
    clearProposal();notice(p.label+' confirmed. View the receipt in Transactions.');
    if(p.id){const next=await readPosition(p.id);positions.set(p.id,next);renderPositions();}
    if(loaded)await loadPool();
    loadWalletTokens();
  }catch(e){clearProposal();notice(failure(e),true);}finally{locked(false);}
}
function view(name){currentView=name;notice(name==='positions'?'Connect your wallet, then refresh or import a position.':name==='activity'?'Transactions are filtered by your connected wallet.':'Load a token pair to read its current pool state.');document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===name));document.querySelectorAll('main>.view').forEach(v=>v.hidden=v.id!==name+'View');$('breadcrumb').textContent=name==='add'?'LP':name==='positions'?'My positions':'Transactions';}
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>view(b.dataset.view));
$('walletButton').onclick=()=>chooseWallet().catch(e=>notice(failure(e),true));
$('disconnect').onclick=()=>{if(injected?.removeListener){injected.removeListener('accountsChanged',oldAccountListener);injected.removeListener('chainChanged',oldChainListener);injected.removeListener('disconnect',oldDisconnectListener);}injected=null;resetWallet();notice('Disconnected from this page. Existing token approvals remain onchain.');};
$('closeWallet').onclick=()=>$('walletDialog').close();$('cancelReview').onclick=clearProposal;$('submitAction').onclick=execute;
$('reviewDialog').addEventListener('cancel',e=>{if(busy)e.preventDefault();else clearProposal();});
$('poolForm').onsubmit=reviewDeposit;$('loadPool').onclick=loadPool;$('tokenAddress').oninput=()=>{invalidate();$('tokenAmount').value='';$('tokenAmountLabel').textContent='Token budget';showSelectedToken();};$('fee').onchange=invalidate;
['rwiAmount','tokenAmount','slippage'].forEach(id=>$(id).addEventListener('input',clearProposal));
$('refreshPositions').onclick=refreshPositions;$('importPosition').onclick=importPosition;
$('positionList').onclick=e=>{const b=e.target.closest('[data-action]');if(b&&!busy)reviewPosition(b.dataset.id,b.dataset.action);};
$('copyRwi').onclick=async()=>{try{await navigator.clipboard.writeText(getAddress(P.RWI));notice('RWI contract copied.');}catch{notice('Copy this contract: '+getAddress(P.RWI));}};
$('openTokens').onclick=()=>{if(!account){chooseWallet().catch(e=>notice(failure(e),true));return;}$('tokenSearch').value='';renderWalletTokens();$('tokenDialog').showModal();};
$('closeTokens').onclick=()=>$('tokenDialog').close();$('refreshTokens').onclick=()=>loadWalletTokens();$('tokenSearch').oninput=renderWalletTokens;
$('walletTokenList').onclick=e=>{const button=e.target.closest('[data-wallet-token]');if(!button||busy)return;const row=walletTokens.find(t=>t.address===button.dataset.walletToken);if(!row)return;invalidate();$('tokenAddress').value=row.address;$('tokenAmount').value='';$('tokenAmountLabel').textContent=row.symbol+' budget';showSelectedToken(row);$('tokenDialog').close();loadPool();};
renderActivity();loadPool();
