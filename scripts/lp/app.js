import { JsonRpcProvider, BrowserProvider, Contract, getAddress, formatUnits, Interface } from 'ethers';
import * as P from './protocol.js';
import { sortHoldings, usdLabel, holdingValue } from './wallet-tokens.js';
import { tokenLogoCandidates } from './token-logos.js';
import { createLogoLoader } from './logo-loader.js';
import { walletCandidates } from './wallet-providers.js';
import { readWalletHoldings } from './wallet-balances.js';
import { matchDollarAmounts } from './deposit-amounts.js';
import { featuredLiquidityUrl } from './featured-pools.js';
import { saveConnector, forgetConnector, savedConnector } from './wallet-session.js';
import { discoverPositionIds } from './position-discovery.js';
import { readPositionsFast } from './position-reader.js';
import { valuePositions, positionFeeValue } from './position-values.js';
import { atomicSupport, checkPendingBatch, sendAtomicBatch } from './wallet-batch.js';
import { cleanTransactions } from './transaction-history.js';
import { createLaunchController } from './launch-client.js';

const $=id=>document.getElementById(id);
const rpc=new JsonRpcProvider('https://rpc.mainnet.chain.robinhood.com',P.CHAIN,{staticNetwork:true,cacheTimeout:-1});
const manager=new Contract(P.CONTRACTS.manager,P.MANAGER,rpc),stateView=new Contract(P.CONTRACTS.state,P.STATE,rpc);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short=s=>s.slice(0,6)+'…'+s.slice(-4);
const fmt=(n,d)=>{const s=formatUnits(n,d);return s.length>24?s.slice(0,24)+'…':s;};
const txLink=hash=>'https://robin.etherscan.io/tx/'+hash;
let injected=null,wallet=null,account=null,session=0,busy=false,loaded=null,proposal=null,verified=false,positions=new Map(),loadSeq=0;
let verifiedPending=null;
let positionsRequest=0,positionsLoading=null,positionsTimer=null;
const positionScans=new Map();
let withdrawalChoice=null;
let depositTarget=null;
function clearDepositTarget(){depositTarget=null;$('liquidityModeTag').textContent='FULL RANGE · NO HOOKS';$('positionDepositNote').hidden=true;$('feeControl').hidden=false;}
async function addToPosition(id){
  locked(true);
  try{
    const p=await readPosition(id);depositTarget=p;clearProposal();
    const other=p.live.tokens.find(t=>t.address.toLowerCase()!==P.RWI);
    $('tokenAddress').value=other.address;amountDriver={side:'rwi',percent:0};
    $('positionDepositNote').hidden=false;$('feeControl').hidden=true;$('liquidityModeTag').textContent='EXISTING POSITION · NO HOOKS';
    $('positionDepositText').textContent='Adding to position #'+id+' · '+p.live.tokens.map(t=>t.symbol).join(' / ')+' · '+(p.live.key.fee/10000)+'% fee. Your existing range is preserved.';
    view('add');await loadPool();$('positionDepositNote').scrollIntoView?.({behavior:'smooth',block:'center'});
  }catch(e){clearDepositTarget();notice(failure(e),true);}finally{locked(false);}
}
function closeWithdrawal(){withdrawalChoice=null;$('withdrawDialog').close();}
function openWithdrawal(id){
  const p=positions.get(id);if(!p||p.external||p.liquidity===0n||!account)return;
  clearProposal();withdrawalChoice={id,who:account,epoch:session};
  $('withdrawPair').textContent=p.live.tokens.map(t=>t.symbol).join(' / ')+' · Position '+id;
  $('withdrawPercent').value='25';updateWithdrawal();$('withdrawDialog').showModal();
}
function updateWithdrawal(){
  const percentage=Number($('withdrawPercent').value);
  $('withdrawPercentLabel').textContent=percentage+'%';
  $('withdrawPercent').setAttribute('aria-valuetext',percentage+'% of this position');
  $('reviewWithdrawal').disabled=busy||!Number.isInteger(percentage)||percentage<=0||percentage>100;
}
let currentView='add';
let featuredRequest=0;
const logoLoader=createLogoLoader();
const tokenIdentityCache=new Map([[P.WETH,{address:P.WETH,symbol:'WETH',name:'Wrapped Ether'}]]);
const logoMetadataCache=new Map();
const logoMetadataInFlight=new Map();
let stopTokenRowLogos=()=>{};
let cancelSelectedLogo=null;
let walletTokens=[],tokenRequest=0,tokenAbort=null,tokenListMessage='';
const amountHoldings=new Map(),amountPrices=new Map();
let amountDriver={side:'rwi',percent:0},amountSelection={rwi:0n,token:0n};
function renderAmountControls(){
  const states={};
  for(const side of ['rwi','token']){
    const address=side==='rwi'?P.RWI:$('tokenAddress').value.trim().toLowerCase(),held=amountHoldings.get(address);
    states[side]=held?{...held,priceUsd:walletTokens.find(t=>t.address===address)?.priceUsd??amountPrices.get(address)??null}:null;
  }
  const source=amountDriver.side,target=source==='rwi'?'token':'rwi';
  const match=states[source]&&states[target]?matchDollarAmounts(states[source],states[target],amountDriver.percent):null;
  const next={rwi:0n,token:0n};if(match){next[source]=match.sourceAmount;next[target]=match.targetAmount;}
  if(proposal?.kind==='deposit'&&(next.rwi!==amountSelection.rwi||next.token!==amountSelection.token))clearProposal();
  amountSelection=next;
  for(const side of ['rwi','token']){
    const held=states[side],slider=$(side+'Percent'),percent=match?(side===source?match.sourcePercent:match.targetPercent):0;
    slider.value=String(percent);slider.disabled=busy||!account||!match||!states.rwi?.balance||!states.token?.balance;
    $(side+'PercentValue').textContent=percent+'%';slider.setAttribute('aria-valuetext',percent+'% of your '+(side==='rwi'?'RWI':held?.symbol||'token')+' holdings');
    $(side+'Amount').textContent=!account?'$0.00':held?match?usdLabel(holdingValue(next[side],held.decimals,held.priceUsd)):'USD unavailable':'—';
    $(side+'Available').textContent=!account?'Connect wallet to choose an amount.':held?'Available: '+usdLabel(holdingValue(held.balance,held.decimals,held.priceUsd)):'Loading wallet balance…';
  }
  $('reviewLiquidity').disabled=busy||Boolean(account)&&(amountSelection.rwi<=0n||amountSelection.token<=0n||!loaded);
  $('amountMatchNote').textContent=!account?'Move either slider to match both sides in USD.':!match?'Waiting for both wallet balances and USD prices.':match.capped?'Matched to the smaller wallet holding.':'Both sides match in USD, rounded down to token precision.';
}
function resetAmountControls(){amountHoldings.clear();amountDriver={side:'rwi',percent:0};renderAmountControls();}
function selectedAmount(side){
  const amount=amountSelection[side];
  if(amount<=0n||amount>=(1n<<128n))throw Error('Choose a positive matched amount for both tokens.');
  return amount;
}
async function loadFeaturedPools(){
  const request=++featuredRequest;$('refreshFeatured').disabled=true;
  try{
    const response=await fetch('/api/lp-featured-pools',{signal:AbortSignal.timeout(12000)}),body=await response.json();
    if(request!==featuredRequest)return;
    if(!response.ok||!Array.isArray(body.pools))throw Error('Pool data unavailable');
    const pools=body.pools.filter(p=>/^0x(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(p.address));
    const money=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(value);
    $('featuredPoolList').innerHTML=pools.length?pools.map(p=>'<article class="featured-pool"><div class="featured-pair"><div class="featured-icons"><img src="/assets/rwi-logo.webp" alt="RWI" width="32" height="32"><img data-featured-logo="'+p.address+'" alt="" width="32" height="32" hidden></div><div><h3>'+esc(p.name)+'</h3><p>'+esc(p.dex)+'</p></div></div><div class="featured-metrics"><div><span>24H VOLUME</span><strong>'+esc(money(p.volume24h))+'</strong></div><div><span>LIQUIDITY</span><strong>'+esc(money(p.liquidityUsd))+'</strong></div></div><div class="featured-actions"><a class="primary-button" href="'+esc(featuredLiquidityUrl(p.address))+'" target="_blank" rel="noopener" title="Add liquidity to this exact pool on Uniswap">Add liquidity ↗</a><a href="https://www.geckoterminal.com/robinhood/pools/'+p.address+'" target="_blank" rel="noopener">View pool ↗</a></div></article>').join(''):'<p class="help">No RWI pools have reported trading volume and liquidity in the last 24 hours.</p>';
    for(const image of document.querySelectorAll('[data-featured-logo]')){
      const other=pools.find(p=>p.address===image.dataset.featuredLogo)?.other;if(!other)continue;
      const token={...other,address:[P.ZERO,'0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'].includes(other.address)?P.WETH:other.address};
      if(!/^0x[0-9a-f]{40}$/.test(token.address))continue;
      logoLoader.load(token,result=>{if(request!==featuredRequest||!image.isConnected)return;image.src=result.src;image.hidden=false;});
    }
    const updated=new Date(body.updatedAt);
    $('featuredPoolNote').textContent='GeckoTerminal market data · '+(body.stale?'Last available data':'Updated')+' '+(Number.isNaN(updated.getTime())?'recently':updated.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}))+(body.partial?' · Indexed pools shown.':' · Active pools only.');
  }catch{
    if(request===featuredRequest){$('featuredPoolList').innerHTML='<p class="help">Featured pools are temporarily unavailable. Use Refresh to try again.</p>';$('featuredPoolNote').textContent='';}
  }finally{if(request===featuredRequest)$('refreshFeatured').disabled=false;}
}
let pending=cleanTransactions(readStore('rwi-lp-transactions',[]));
const discovered=new Map();
let connectionAttempt=0;
const restoredProviders=new WeakSet();
function readStore(k,fallback){try{const v=JSON.parse(localStorage.getItem(k));return Array.isArray(v)?v:fallback;}catch{return fallback;}}
function saveStore(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch{}}
function idsKey(){return 'rwi-lp-positions-'+account?.toLowerCase();}
function remember(id){const ids=readStore(idsKey(),[]);if(!ids.includes(id))saveStore(idsKey(),[id,...ids].slice(0,100));}
function notice(msg,error=false){$('notice').hidden=!msg;$('notice').textContent=msg;$('notice').className=error?'notice error':'notice';}
function failure(e){if(e.code===4001||e.code==='ACTION_REJECTED')return 'Request cancelled in your wallet.';return e.shortMessage||e.reason||e.message||'The request failed. Try refreshing the chain data.';}
function locked(v){busy=v;document.querySelectorAll('main input,main select,main textarea,main button,#walletButton,#disconnect,#tradeDialog input,#tradeDialog button').forEach(el=>el.disabled=v);$('submitAction').disabled=v||!proposal;$('cancelReview').disabled=v;document.querySelectorAll('#positionList [data-action="remove"]').forEach(b=>{b.disabled=v||positions.get(b.dataset.id)?.liquidity===0n;});renderAmountControls();launchesUI.updateDisabled(v);}
function clearProposal(){proposal=null;$('reviewDialog').close();}
function invalidate(){loadSeq++;loaded=null;clearProposal();$('poolStatus').textContent='Refresh pool data';$('poolPrice').textContent='—';$('poolId').textContent='—';$('poolLink').hidden=true;$('pairName').textContent='Token / RWI';$('poolBlock').textContent='Load to refresh chain data';}
function resetWallet(){clearDepositTarget();closeWithdrawal();connectionAttempt++;forgetConnector(localStorage);session++;positionsRequest++;clearTimeout(positionsTimer);resetTokens();account=null;wallet=null;renderAmountControls();positions.clear();$('walletButton').textContent='Connect wallet';$('disconnect').hidden=true;$('walletStatus').textContent='Connect to see balances and your positions.';$('positionList').innerHTML='<div class="empty-state">Connect your wallet to load your liquidity positions.</div>';$('positionsStatus').textContent='Connect your wallet to find positions automatically.';clearProposal();renderActivity();}
async function verifyContracts(){
  if(verified)return;
  if(!verifiedPending)verifiedPending=(async()=>{
    const [chain,pool,permit]=await Promise.all([rpc.send('eth_chainId',[]),manager.poolManager(),manager.permit2()]);
    if(Number(chain)!==P.CHAIN||pool.toLowerCase()!==P.CONTRACTS.pool||permit.toLowerCase()!==P.CONTRACTS.permit)throw Error('The liquidity contracts do not match this network. Transactions are disabled.');
    verified=true;
  })().finally(()=>{verifiedPending=null;});
  await verifiedPending;
}
async function metadata(address){
  address=getAddress(address.trim());if(address===P.ZERO)throw Error('Use an ERC-20 contract address. To pair ETH, use WETH.');
  const c=new Contract(address,P.ERC20,rpc);
  const [symbol,decimals,name]=await Promise.all([c.symbol(),c.decimals(),c.name().catch(()=>null)]);
  if(Number(decimals)>36)throw Error('This token has unsupported decimals.');
  return P.token(address,Number(decimals),String(symbol).slice(0,24),address.toLowerCase()===P.WETH?'Wrapped Ether':String(name||symbol).slice(0,80));
}
async function snapshot(k,tokens,initial){
  const block=await rpc.getBlockNumber(),id=P.poolId(k);
  const [slot,liq]=await Promise.all([stateView.getSlot0(id,{blockTag:block}),stateView.getLiquidity(id,{blockTag:block})]);
  return {key:k,tokens,id,slot,liquidity:liq,block,exists:slot[0]>0n,pool:slot[0]>0n||initial?P.buildPool(k,tokens,slot,liq,initial):null};
}
async function loadPool(){
  const seq=++loadSeq,epoch=session;loaded=null;if(currentView==='add')notice('Reading pool state from Robinhood Chain…');
  $('poolStatus').textContent='Loading';$('poolPrice').textContent='—';$('poolId').textContent='—';$('poolLink').hidden=true;$('poolBlock').textContent='Reading Robinhood Chain';$('pairName').textContent='Token / RWI';
  try{
    const address=getAddress($('tokenAddress').value.trim()).toLowerCase();
    const hint=walletTokens.find(t=>t.address===address)||tokenIdentityCache.get(address)||{address,symbol:'Token',name:'Loading token details…'};
    showSelectedToken(hint);loadTokenLogo(hint,seq,epoch);
    let other,data;
    if(depositTarget){
      const p=await readPosition(depositTarget.id);
      if(seq!==loadSeq||epoch!==session)return;
      depositTarget=p;other=p.live.tokens.find(t=>t.address.toLowerCase()!==P.RWI);data=p.live;
    }else{
      [,other]=await Promise.all([verifyContracts(),metadata(address)]);
      const fee=Number($('fee').value),key=P.pair(other,fee);
      const rwi=P.token(P.RWI,18,'RWI'),tokens=key.currency0.toLowerCase()===P.RWI?[rwi,other]:[other,rwi];
      data=await snapshot(key,tokens);
    }
    if(seq!==loadSeq||epoch!==session)return;
    tokenIdentityCache.set(address,other);showSelectedToken(walletTokens.find(t=>t.address===address)||other);
    if(seq!==loadSeq||epoch!==session)return;
    loaded=data;$('tokenAmountLabel').textContent=other.symbol+' amount (USD)';$('pairName').textContent=other.symbol+' / RWI';
    $('poolStatus').textContent=data.exists?'Initialized pool':'New pool';$('poolId').textContent=data.id;$('poolLink').href='https://app.uniswap.org/explore/pools/robinhood/'+data.id;$('poolLink').hidden=!data.exists;
    $('poolPrice').textContent=data.exists?data.pool.priceOf(other).toSignificant(8)+' RWI / '+other.symbol:'Set by your two initial deposits';
    $('poolBlock').textContent='Read at block '+data.block.toLocaleString();
    if(currentView==='add')notice(data.exists?'Pool loaded. Deposits use the live pool price.':'No pool exists for this token and fee tier. Your first deposit will initialize it.');
    if(account)await balances(data);
  }catch(e){if(seq===loadSeq&&epoch===session){$('poolStatus').textContent='Could not load';$('poolBlock').textContent='Check the token address and try Load again.';notice(failure(e),true);}}
}
async function balances(data){
  const epoch=session,who=account;if(!who)return;
  const values=await Promise.all(data.tokens.map(t=>new Contract(t.address,P.ERC20,rpc).balanceOf(who)));
  if(epoch!==session||who!==account||loaded!==data)return;
  data.tokens.forEach((t,i)=>amountHoldings.set(t.address.toLowerCase(),{balance:values[i],decimals:t.decimals,symbol:t.symbol}));renderAmountControls();
  fetch('/api/lp-token-prices?addresses='+data.tokens.map(t=>t.address.toLowerCase()).join(','),{signal:AbortSignal.timeout(8000)}).then(async response=>{
    if(!response.ok)return;const body=await response.json();if(epoch!==session||who!==account||loaded!==data)return;
    for(const t of data.tokens){const address=t.address.toLowerCase(),price=body.prices?.[address];if(typeof price==='string'&&/^\d{1,60}(?:\.\d{1,60})?$/.test(price))amountPrices.set(address,price);}
    renderAmountControls();
  }).catch(()=>{});
  $('walletStatus').textContent=values.map((n,i)=>fmt(n,data.tokens[i].decimals)+' '+data.tokens[i].symbol).join(' · ');
}

function showSelectedToken(token){
  const label=$('walletTokenLabel');
  if(!token){cancelSelectedLogo?.();label.textContent='Choose a wallet token';label.dataset.address='';return;}
  const address=token.address.toLowerCase(),name=token.name||token.symbol,candidates=tokenLogoCandidates(token).join('|');
  if(label.dataset.address===address&&label.querySelector('.selected-token-logo')){
    label.querySelector('.selected-token-copy strong').textContent=token.symbol;label.querySelector('.selected-token-name').textContent=name;
    if(label.dataset.candidates===candidates)return;
  }else{
    label.innerHTML='<span class="selected-token-avatar"><span class="token-monogram">'+esc(token.symbol.slice(0,2))+'</span><img class="selected-token-logo" alt="" referrerpolicy="no-referrer" hidden></span><span class="selected-token-copy"><strong>'+esc(token.symbol)+'</strong><span class="selected-token-name">'+esc(name)+'</span></span>';
  }
  label.dataset.address=address;label.dataset.candidates=candidates;cancelSelectedLogo?.();
  const image=label.querySelector('img');
  const missing=()=>{if(label.contains(image)&&label.dataset.address===address){image.hidden=true;label.querySelector('.token-monogram').hidden=false;}};
  cancelSelectedLogo=logoLoader.load(token,result=>{
    if(!label.contains(image)||label.dataset.address!==address)return;
    const display=()=>{if(label.contains(image)&&image.naturalWidth){image.hidden=false;label.querySelector('.token-monogram').hidden=true;}};
    image.onload=display;image.onerror=()=>{if(label.contains(image)){image.hidden=true;label.querySelector('.token-monogram').hidden=false;}};image.src=result.src;if(image.complete)display();
  },missing);
}
async function tokenLogoMetadata(token){
  const address=token.address.toLowerCase();if(address===P.WETH||address===P.RWI)return null;
  if(logoMetadataCache.has(address))return logoMetadataCache.get(address);
  if(!logoMetadataInFlight.has(address)){
    const request=(async()=>{try{
      const response=await fetch('/api/lp-token-logo?address='+address,{signal:AbortSignal.timeout(10000)});if(!response.ok)return null;
      const body=await response.json();if(body.address!==address||!Array.isArray(body.logos))return null;
      if(body.logos.length)logoMetadataCache.set(address,body);return body;
    }catch{return null;}finally{logoMetadataInFlight.delete(address);}})();
    logoMetadataInFlight.set(address,request);
  }
  return logoMetadataInFlight.get(address);
}
async function loadTokenLogo(token,seq,epoch){
  const address=token.address.toLowerCase(),body=await tokenLogoMetadata(token);
  if(!body||seq!==loadSeq||epoch!==session||$('tokenAddress').value.toLowerCase()!==address)return;
  const current=tokenIdentityCache.get(address)||walletTokens.find(t=>t.address===address)||token;
  if(body.logos.length)showSelectedToken({address,symbol:current.symbol,name:current.name,logo:walletTokens.find(t=>t.address===address)?.logo,logos:body.logos});
}
function observeTokenRowLogos(rows){
  const root=$('walletTokenList'),tokens=new Map(rows.map(t=>[t.address,t])),started=new Set(),cancellations=[];
  let stopped=false,observer=null;
  const start=button=>{
    if(stopped||started.has(button))return;started.add(button);
    const token=tokens.get(button.dataset.walletToken),image=button.querySelector('.wallet-token-logo'),monogram=button.querySelector('.list-token-monogram');
    if(!token||!image)return;
    let cancel=()=>{};
    const current=()=>!stopped&&root.contains(button);
    const display=result=>{
      if(!current())return;
      const show=()=>{if(current()&&image.naturalWidth){image.hidden=false;monogram.hidden=true;}};
      image.onload=show;image.onerror=()=>{if(current()){image.hidden=true;monogram.hidden=false;}};image.src=result.src;if(image.complete)show();
    };
    const missing=()=>{if(current()){image.hidden=true;monogram.hidden=false;}};
    const initial={...token,logos:logoMetadataCache.get(token.address)?.logos},candidates=tokenLogoCandidates(initial).join('|');
    cancel=logoLoader.load(initial,display,missing);
    // Resolve onchain artwork even when an indexer already supplied a thumbnail.
    // Initial candidates remain fast; the canonical upload can replace them later.
    tokenLogoMetadata(token).then(body=>{const updated={...token,logos:body?.logos};if(current()&&body?.logos.length&&tokenLogoCandidates(updated).join('|')!==candidates){cancel();cancel=logoLoader.load(updated,display,missing);}});
    cancellations.push(()=>{cancel();image.onload=image.onerror=null;});
  };
  const buttons=[...root.querySelectorAll('[data-wallet-token]')];
  const checkVisible=()=>{if(stopped||!$('tokenDialog').open)return;const r=root.getBoundingClientRect();for(const button of buttons){const b=button.getBoundingClientRect();if(b.bottom>=r.top-50&&b.top<=r.bottom+50)start(button);}};
  if(typeof IntersectionObserver==='function'){
    observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){start(entry.target);observer.unobserve(entry.target);}},{root,rootMargin:'50px'});
    buttons.forEach(button=>observer.observe(button));
  }else{root.addEventListener('scroll',checkVisible,{passive:true});requestAnimationFrame(checkVisible);}
  return()=>{stopped=true;observer?.disconnect();root.removeEventListener('scroll',checkVisible);cancellations.forEach(cancel=>cancel());};
}
function resetTokens(){
  resetAmountControls();
  stopTokenRowLogos();
  tokenRequest++;tokenAbort?.abort();tokenAbort=null;walletTokens=[];tokenListMessage='';
  $('walletTokenStatus').textContent='Connect your wallet to see holdings, highest USD value first.';$('walletTokenList').innerHTML='';$('tokenListNote').textContent='';$('tokenDialog').close();
}
function renderWalletTokens(){
  stopTokenRowLogos();
  const query=$('tokenSearch').value.trim().toLowerCase();
  const rows=walletTokens.filter(t=>[t.name,t.symbol,t.address].some(v=>v.toLowerCase().includes(query)));
  $('walletTokenList').innerHTML=rows.length?rows.map(t=>'<button type="button" class="wallet-token-option" data-wallet-token="'+t.address+'"><span class="token-list-avatar"><span class="list-token-monogram">'+esc(t.symbol.slice(0,2))+'</span><img class="wallet-token-logo" alt="" width="32" height="32" referrerpolicy="no-referrer" hidden></span><span class="token-left"><strong>'+esc(t.symbol)+'</strong><small>'+esc(t.name)+'</small><small>'+short(t.address)+'</small></span><span class="token-value">'+usdLabel(t.valueUsd)+'<small>'+esc(fmt(t.balance,t.decimals))+' '+esc(t.symbol)+'</small></span></button>').join(''):'<p class="help">'+esc(query?'No matching tokens.':tokenListMessage||'No supported ERC-20 holdings found. You can still enter a token contract.')+'</p>';
  $('tokenListNote').textContent=tokenListMessage;
  if(rows.length)stopTokenRowLogos=observeTokenRowLogos(rows);
}
async function loadWalletTokens(){
  const who=account,epoch=session,request=++tokenRequest;if(!who)return;
  tokenAbort?.abort();const controller=new AbortController();tokenAbort=controller;
  const active=()=>request===tokenRequest&&epoch===session&&who===account&&!controller.signal.aborted;
  tokenListMessage=walletTokens.length?'Refreshing your wallet holdings…':'Loading your wallet holdings…';$('walletTokenStatus').textContent=tokenListMessage;renderWalletTokens();
  try{
    if(Number(await injected.request({method:'eth_chainId'}))!==P.CHAIN)throw Error('Switch to Robinhood Chain to load your holdings.');
    const response=await fetch('/api/lp-wallet-tokens?address='+who.toLowerCase(),{cache:'no-store',signal:controller.signal});
    const body=await response.json();if(!response.ok)throw Error(body.error||'Wallet holdings are temporarily unavailable.');
    if(!Array.isArray(body.tokens))throw Error('Wallet holdings could not be read.');
    if(!active())return;
    const {rows,failed}=await readWalletHoldings(body.tokens,who,request=>rpc.call(request));
    if(!active())return;
    walletTokens=sortHoldings(rows);renderAmountControls();const unpriced=walletTokens.filter(t=>t.valueUsd===null).length;
    tokenListMessage=(body.partial||failed?'Some holdings could not be loaded; enter a contract for a missing token. ':'')+(unpriced?unpriced+' token'+(unpriced===1?' has':'s have')+' no current USD price and '+(unpriced===1?'appears':'appear')+' last. ':'')+'USD values are estimates. Updated '+new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})+'.';
    $('walletTokenStatus').textContent=walletTokens.length+' wallet token'+(walletTokens.length===1?'':'s')+' · sorted by value held in USD'+(body.partial||failed?' · partial list':'');
    renderWalletTokens();
  }catch(e){
    if(!active())return;tokenListMessage=failure(e)+' You can still enter a token contract.';$('walletTokenStatus').textContent=tokenListMessage;renderWalletTokens();
  }finally{if(active())tokenAbort=null;}
}

function walletCandidate(detail){if(detail?.provider&&detail?.info?.uuid){discovered.set(detail.info.uuid,{name:detail.info.name,rdns:detail.info.rdns,provider:detail.provider});Promise.resolve().then(restoreWallet);}}
async function restoreWallet(){
  if(account||injected)return;
  const candidate=savedConnector(localStorage,walletCandidates([...discovered.values()],window.ethereum));
  if(!candidate||restoredProviders.has(candidate.provider))return;
  restoredProviders.add(candidate.provider);await connect(candidate.provider,true,candidate);
}
window.addEventListener('eip6963:announceProvider',e=>walletCandidate(e.detail));window.dispatchEvent(new Event('eip6963:requestProvider'));
async function chooseWallet(){
  if(account){await switchNetwork();return;}
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  const candidates=walletCandidates([...discovered.values()],window.ethereum);
  const list=$('walletChoices');list.innerHTML='';
  if(!candidates.length){list.innerHTML='<p>No browser wallet was detected. Open this page in your wallet’s browser or install an Ethereum-compatible wallet.</p>';}
  candidates.forEach(c=>{const b=document.createElement('button');b.className='secondary-button';b.textContent=c.name;b.onclick=()=>connect(c.provider,false,c);list.append(b);});
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
  const epoch=++session;clearDepositTarget();closeWithdrawal();positionsRequest++;clearTimeout(positionsTimer);resetTokens();clearProposal();positions.clear();
  const [accounts,chain]=await Promise.all([provider.request({method:'eth_accounts'}),provider.request({method:'eth_chainId'})]);
  if(epoch!==session||provider!==injected)return;
  if(!accounts.length){resetWallet();return;}
  account=getAddress(accounts[0]);wallet=new BrowserProvider(provider,'any',{cacheTimeout:-1});renderAmountControls();
  $('walletButton').textContent=Number(chain)===P.CHAIN?short(account):'Switch network';$('disconnect').hidden=false;
  $('walletStatus').textContent=Number(chain)===P.CHAIN?'Connected on Robinhood Chain.':'Switch to Robinhood Chain to manage liquidity.';
  $('positionList').innerHTML='<div class="empty-state">Loading your positions automatically…</div>';$('positionsStatus').textContent='Checking your position history…';
  renderActivity();
  if(Number(chain)!==P.CHAIN){tokenListMessage='Switch to Robinhood Chain to load your holdings.';$('walletTokenStatus').textContent=tokenListMessage;}
  if(Number(chain)===P.CHAIN){loadPositions();loadWalletTokens();if(loaded)await balances(loaded);else loadPool();}
}
let oldAccountListener,oldChainListener,oldDisconnectListener;
async function connect(provider,restore=false,candidate=null){
  const attempt=++connectionAttempt;
  try{
    const accounts=await provider.request({method:restore?'eth_accounts':'eth_requestAccounts'});
    if(attempt!==connectionAttempt||!accounts?.length)return;
    if(injected?.removeListener){injected.removeListener('accountsChanged',oldAccountListener);injected.removeListener('chainChanged',oldChainListener);injected.removeListener('disconnect',oldDisconnectListener);}
    injected=provider;
    oldAccountListener=()=>syncWallet().catch(e=>notice(failure(e),true));oldChainListener=oldAccountListener;oldDisconnectListener=()=>{if(injected!==provider)return;provider.removeListener?.('accountsChanged',oldAccountListener);provider.removeListener?.('chainChanged',oldChainListener);provider.removeListener?.('disconnect',oldDisconnectListener);injected=null;resetWallet();notice('Wallet disconnected.');};
    provider.on?.('accountsChanged',oldAccountListener);provider.on?.('chainChanged',oldChainListener);provider.on?.('disconnect',oldDisconnectListener);
    $('walletDialog').close();await syncWallet();
    if(injected===provider&&account)saveConnector(localStorage,candidate||walletCandidates([...discovered.values()],window.ethereum).find(c=>c.provider===provider));
  }catch(e){if(!restore&&attempt===connectionAttempt)notice(failure(e),true);}
}
async function signerFor(who,epoch){
  if(!injected||!wallet||session!==epoch||account!==who)throw Error('Your wallet changed. Review the action again.');
  const [chain,accounts]=await Promise.all([injected.request({method:'eth_chainId'}),injected.request({method:'eth_accounts'})]);
  if(session!==epoch||Number(chain)!==P.CHAIN||accounts[0]?.toLowerCase()!==who.toLowerCase())throw Error('Wallet or network changed. Review the action again.');
  return wallet.getSigner(who);
}
function activity(entry){pending=cleanTransactions([{account:account?.toLowerCase(),...entry,chain:P.CHAIN,time:new Date().toISOString()},...pending]);saveStore('rwi-lp-transactions',pending);renderActivity();}
function updateActivity(hash,status){const entry=pending.find(x=>x.hash===hash);if(entry){entry.status=status;saveStore('rwi-lp-transactions',pending);renderActivity();}}
function renderActivity(){
  const rows=pending.filter(x=>x.account===account?.toLowerCase());
  $('activityList').innerHTML=rows.length?rows.map(x=>'<div class="activity-row"><div><strong>'+esc(x.label)+'</strong><small>'+esc(x.status)+' · '+esc(new Date(x.time).toLocaleString())+'</small></div><a target="_blank" rel="noopener" href="'+esc(txLink(x.hash))+'">'+short(x.hash)+' ↗</a></div>').join(''):'<div class="empty-state">Your submitted transactions will appear here. No sample activity.</div>';
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
async function approvalCalls(p){
  const expiration=Math.floor(Date.now()/1000)+1200,calls=[];
  for(let i=0;i<2;i++){
    const t=p.position.pool['currency'+i],cap=p.caps[i];if(cap===0n)continue;
    const contract=new Contract(t.address,P.ERC20,rpc),permit=new Contract(P.CONTRACTS.permit,P.PERMIT,rpc);
    const [allowance,a]=await Promise.all([contract.allowance(p.who,P.CONTRACTS.permit),permit.allowance(p.who,t.address,P.CONTRACTS.manager)]);
    if(allowance<cap){
      if(allowance>0n)calls.push({to:t.address,data:contract.interface.encodeFunctionData('approve',[P.CONTRACTS.permit,0n]),label:'Reset '+t.symbol+' allowance'});
      calls.push({to:t.address,data:contract.interface.encodeFunctionData('approve',[P.CONTRACTS.permit,cap]),label:'Approve '+t.symbol+' to Permit2'});
    }
    if(a[0]<cap||a[1]<BigInt(Math.floor(Date.now()/1000)+600))calls.push({to:P.CONTRACTS.permit,data:permit.interface.encodeFunctionData('approve',[t.address,P.CONTRACTS.manager,cap,expiration]),label:'Authorize '+t.symbol+' for LP deposit'});
  }
  return calls;
}
async function approvals(p,signer){
  for(const {label,...request} of await approvalCalls(p))await send(signer,request,label,p.who,p.epoch);
}
function showReview(p,rows){
  proposal=p;launchesUI.renderReview(p);$('reviewTitle').textContent=p.label;$('reviewRows').innerHTML=rows.map(([a,b])=>'<dt>'+esc(a)+'</dt><dd>'+esc(b)+'</dd>').join('');
  $('approvalNote').hidden=p.kind!=='deposit';$('submitAction').textContent=p.kind==='deposit'?'Confirm deposit':'Confirm in wallet';$('submitAction').disabled=false;$('reviewDialog').showModal();
}
async function reviewDeposit(event){
  event?.preventDefault();if(!account){await chooseWallet();return;}locked(true);
  try{
    if(!account)throw Error('Connect your wallet first.');const who=account,epoch=session;await signerFor(who,epoch);await loadPool();
    if(!loaded)throw Error('Pool data could not be loaded.');const data=loaded;
    const other=data.tokens.find(t=>t.address.toLowerCase()!==P.RWI),r=selectedAmount('rwi'),t=selectedAmount('token');
    const budgets=data.key.currency0.toLowerCase()===P.RWI?[r,t]:[t,r];
    const live=await snapshot(data.key,data.tokens,budgets),slip=P.DEFAULT_SLIPPAGE_BPS;
    const target=depositTarget;
    const {position,caps}=P.makeDeposit(live.pool,budgets,slip,target?[target.position.tickLower,target.position.tickUpper]:undefined);
    const balances=await Promise.all(data.tokens.map(t=>new Contract(t.address,P.ERC20,rpc).balanceOf(who)));
    if(balances.some((n,i)=>n<caps[i]))throw Error('Your wallet does not have enough tokens for this deposit.');
    await signerFor(who,epoch);
    const p={kind:'deposit',id:target?.id,who,epoch,position,caps,live,slip,createdAt:Date.now(),label:target?'Add to position #'+target.id:live.exists?'Add liquidity':'Create pool & add liquidity'};
    showReview(p,[...(target?[['Position',target.id]]:[]),['Network','Robinhood Chain (4663)'],['Pair',other.symbol+' / RWI'],['Pool fee',(Number(data.key.fee)/10000)+'%'],['Range',target?'Existing position range':'Full range'],['Pool hooks','None'],['Pool ID',live.id],...caps.map((n,i)=>['Maximum '+data.tokens[i].symbol,formatUnits(n,data.tokens[i].decimals)]),['Slippage',(slip/100)+'%'],['Recipient',who],['Position Manager',P.CONTRACTS.manager],['Expiry','20 minutes from transaction preparation']]);
    notice('Review the deposit. Only your wallet can authorize it.');
  }catch(e){notice(failure(e),true);}finally{locked(false);}
}
async function readPosition(id,includeExternal=false){
  if(!/^\d+$/.test(id)||BigInt(id)<=0n)throw Error('Enter a valid position ID.');await verifyContracts();
  const who=account,epoch=session;if(!who)throw Error('Connect your wallet first.');
  const [owner,result,liquidity]=await Promise.all([manager.ownerOf(id),manager.getPoolAndPositionInfo(id),manager.getPositionLiquidity(id)]);
  if(owner.toLowerCase()!==who.toLowerCase())throw Error('This position is not owned by your connected wallet.');
  const raw=result[0],k={currency0:raw[0],currency1:raw[1],fee:Number(raw[2]),tickSpacing:Number(raw[3]),hooks:raw[4]};
  if(![k.currency0.toLowerCase(),k.currency1.toLowerCase()].includes(P.RWI))throw Error('This position is not paired with RWI.');
  const external=k.hooks.toLowerCase()!==P.ZERO||k.currency0.toLowerCase()===P.ZERO||k.currency1.toLowerCase()===P.ZERO;
  if(external&&!includeExternal)throw Error('Manage this pool through its original venue.');
  const tokens=await Promise.all([k.currency0,k.currency1].map(address=>address.toLowerCase()===P.ZERO?{address:P.ZERO,decimals:18,symbol:'ETH'}:metadata(address)));
  if(session!==epoch||account!==who)throw Error('Wallet changed. Positions will update automatically.');
  if(external)return {id,who,epoch,live:{key:k,tokens,id:P.poolId(k)},liquidity,external:true};
  const live=await snapshot(k,tokens),position=P.ownedPosition(live.pool,liquidity,result[1]);
  if(session!==epoch||account!==who)throw Error('Wallet changed. Positions will update automatically.');
  return {id,who,epoch,live,position,liquidity};
}
const positionVolumes=new Map(),positionVolumeTimes=new Map();
function loadPositionVolumes(){
  const who=account,epoch=session;if(!who)return;
  const ids=[...new Set([...positions.values()].filter(p=>p.liquidity>0n).map(p=>p.live.id))].filter(id=>/^0x[0-9a-fA-F]{64}$/.test(id)&&Date.now()-(positionVolumeTimes.get(id)||0)>60000);
  for(let i=0;i<ids.length;i+=20){
    const batch=ids.slice(i,i+20);batch.forEach(id=>positionVolumeTimes.set(id,Date.now()));
    fetch('/api/lp-pool-volume?pools='+batch.join(','),{signal:AbortSignal.timeout(25000)}).then(async response=>{
      if(!response.ok)throw Error('Volume unavailable');const body=await response.json();
      for(const id of batch){const row=body.pools?.[id];positionVolumes.set(id,row&&/^\d+$/.test(row.amount0)&&/^\d+$/.test(row.amount1)?row:null);}
      if(who===account&&epoch===session)renderPositions(false);
    }).catch(()=>{batch.forEach(id=>positionVolumes.set(id,null));if(who===account&&epoch===session)renderPositions(false);});
  }
}
const positionPriceTimes=new Map();
let cancelPositionLogos=()=>{};
function loadPositionPrices(){
  const who=account,epoch=session;if(!who)return;
  const addresses=[...new Set([...positions.values()].filter(p=>p.liquidity>0n).flatMap(p=>p.live.tokens.map(t=>t.address?.toLowerCase()).map(a=>a===P.ZERO?P.WETH:a)))].filter(a=>/^0x[0-9a-f]{40}$/.test(a)&&Date.now()-(positionPriceTimes.get(a)||0)>60000);
  for(let i=0;i<addresses.length;i+=2){
    const batch=addresses.slice(i,i+2);batch.forEach(a=>positionPriceTimes.set(a,Date.now()));
    fetch('/api/lp-token-prices?addresses='+batch.join(','),{signal:AbortSignal.timeout(8000)}).then(async response=>{
      if(!response.ok)return;const body=await response.json();
      for(const a of batch){const price=body.prices?.[a];if(typeof price==='string'&&/^\d{1,60}(?:\.\d{1,60})?$/.test(price))amountPrices.set(a,price);}
      if(who===account&&epoch===session){renderAmountControls();renderPositions(false);}
    }).catch(()=>{});
  }
}
function renderPositions(requestPrices=true){
  cancelPositionLogos();
  const prices=new Map(walletTokens.filter(t=>t.priceUsd!==null).map(t=>[t.address,t.priceUsd]));for(const [a,price] of amountPrices)prices.set(a,price);if(prices.has(P.WETH))prices.set(P.ZERO,prices.get(P.WETH));
  const rows=valuePositions([...positions.values()],prices);
  $('positionList').innerHTML=rows.length?rows.map(({position:p,valueUsd,estimated})=>{
    const state=p.liquidity===0n?'Empty':p.external?'Managed externally':p.live.pool.tickCurrent>=p.position.tickLower&&p.live.pool.tickCurrent<p.position.tickUpper?'':'Out of range';
    const other=p.live.tokens.find(t=>t.address?.toLowerCase()!==P.RWI),otherAddress=other?.address?.toLowerCase();
    const icon=otherAddress&&/^0x[0-9a-f]{40}$/.test(otherAddress)?'<img data-position-logo="'+otherAddress+'" src="/assets/rwi-logo.webp" alt="" width="32" height="32" hidden>':'';
    const fees=positionFeeValue(p,prices),volume=positionVolumes.get(p.live.id),rwiIndex=p.live.tokens.findIndex(t=>t.address?.toLowerCase()===P.RWI);
    const volumeRaw=volume&&rwiIndex>=0?BigInt(volume['amount'+rwiIndex]):null,volumeUsd=volumeRaw===0n?0n:volumeRaw===null?null:holdingValue(volumeRaw,18,prices.get(P.RWI));
    const feeTokens=p.fees?p.fees.map((raw,i)=>new Intl.NumberFormat('en-US',{maximumSignificantDigits:6}).format(Number(formatUnits(raw,p.live.tokens[i].decimals)))+' '+p.live.tokens[i].symbol).join(' · '):'Fee data unavailable';
    const metrics='<div class="position-metrics"><div><span>24H POOL VOLUME</span><strong>'+esc(positionVolumes.has(p.live.id)?volumeUsd===null?'Unavailable':usdLabel(volumeUsd):'Loading…')+'</strong><small>Estimated at current RWI price</small></div><div><span>UNCOLLECTED FEES</span><strong>'+esc(fees.valueUsd===null?'Unavailable':usdLabel(fees.valueUsd))+'</strong><small>'+esc(feeTokens)+'</small></div></div>';
    const amounts=p.external?'<p class="small muted">Manage this native-ETH or custom-hook position at its original venue.</p>':'<div class="position-breakdown">'+p.live.tokens.map((t,i)=>'<div><span>'+esc(t.symbol)+'</span><strong>'+esc(p.liquidity===0n?'0':p.position['amount'+i].toSignificant(7))+'</strong></div>').join('')+'</div>';
    return '<article class="position-card position-value-card"><div class="position-title"><div class="position-pair"><div class="featured-icons"><img src="/assets/rwi-logo.webp" alt="RWI" width="32" height="32">'+icon+'</div><div><h3>'+esc(p.live.tokens.map(t=>t.symbol).join(' / '))+'</h3><span class="position-fee">'+(p.live.key?.fee!==undefined?esc(p.live.key.fee/10000+'% pool fee'):'RWI pool')+'</span></div></div>'+(state?'<span class="pool-tag">'+esc(state)+'</span>':'')+'</div><div class="position-total"><span class="eyebrow">POSITION VALUE</span><strong>'+esc(valueUsd===null?'USD unavailable':usdLabel(valueUsd))+'</strong><small>'+esc(estimated?'Pool-based estimate · Fees excluded':'Estimated principal · Fees excluded')+'</small></div>'+metrics+amounts+'<div class="position-actions">'+(p.external?'<a class="secondary-button position-add" href="https://app.uniswap.org/positions/v4/robinhood/'+esc(p.id)+'" target="_blank" rel="noopener">Add liquidity ↗</a>':'<button class="secondary-button position-add" data-id="'+p.id+'" data-action="add" '+(busy?'disabled':'')+'>Add liquidity</button>')+(p.external?'':'<button class="secondary-button position-withdraw" data-id="'+p.id+'" data-action="remove" '+(busy||p.liquidity===0n?'disabled':'')+'>Withdraw</button><button class="secondary-button" data-id="'+p.id+'" data-action="collect" '+(busy?'disabled':'')+'>Collect fees</button>')+'</div><div class="position-receipt"><span>Position #'+esc(p.id)+'</span><a href="https://robin.etherscan.io/nft/'+P.CONTRACTS.manager+'/'+p.id+'" target="_blank" rel="noopener">View receipt ↗</a></div></article>';
  }).join(''):'<div class="empty-state">No funded RWI liquidity positions were found for this wallet.</div>';
  const cancels=[];
  for(const image of document.querySelectorAll('[data-position-logo]')){
    const address=image.dataset.positionLogo,token=[...positions.values()].flatMap(p=>p.live.tokens).find(t=>t.address?.toLowerCase()===address);if(!token)continue;
    cancels.push(logoLoader.load({...token,address:address===P.ZERO?P.WETH:address,logo:walletTokens.find(t=>t.address===address)?.logo},result=>{if(image.isConnected){image.src=result.src;image.hidden=false;}}));
  }
  cancelPositionLogos=()=>cancels.forEach(cancel=>cancel());
  if(requestPrices){loadPositionPrices();loadPositionVolumes();}
}
async function importPosition(){locked(true);try{const id=$('positionId').value.trim(),p=await readPosition(id,true);positions.set(id,p);remember(id);renderPositions();notice('Position '+id+' loaded from chain.');}catch(e){notice(failure(e),true);}finally{locked(false);}}
async function loadPositions(){
  if(!account)return;
  if(busy){if(currentView==='positions'){clearTimeout(positionsTimer);positionsTimer=setTimeout(loadPositions,5000);}return;}
  const who=account,epoch=session;if(positionsLoading?.who===who&&positionsLoading.epoch===epoch)return positionsLoading.promise;
  const request=++positionsRequest,active=()=>request===positionsRequest&&epoch===session&&who===account;
  clearTimeout(positionsTimer);$('positionsStatus').textContent=positions.size?'Updating positions…':'Finding your positions…';
  const promise=(async()=>{
    try{
      if(Number(await injected.request({method:'eth_chainId'}))!==P.CHAIN){if(active())$('positionsStatus').textContent='Switch to Robinhood Chain to see positions.';return;}
      const knownIds=readStore(idsKey(),[]).filter(id=>typeof id==='string'&&/^\d+$/.test(id));
      const early=knownIds.length?(async()=>{await verifyContracts();if(!active())return null;const result=await readPositionsFast(rpc,knownIds,who,epoch,P,tokenIdentityCache);if(active()&&result.items.length){positions=new Map(result.items.map(p=>[p.id,p]));renderPositions();$('positionsStatus').textContent='Positions loaded · Checking for new activity…';}return result;})().catch(()=>null):Promise.resolve(null);
      const key=who.toLowerCase(),stored=readStore('rwi-lp-position-scan-'+key,[])[0];
      const checkpoint=stored&&Number.isSafeInteger(stored.block)&&stored.block>=0&&Array.isArray(stored.ids)&&stored.ids.length<=10000&&stored.ids.every(id=>typeof id==='string'&&/^\d+$/.test(id))?stored:undefined;
      const scan=await discoverPositionIds(rpc,P.CONTRACTS.manager,who,positionScans.get(key)||checkpoint);if(!active())return;
      if(!scan.partial){if(positionScans.size>=5&&!positionScans.has(key))positionScans.delete(positionScans.keys().next().value);positionScans.set(key,scan);if(scan.ids.length<=10000)saveStore('rwi-lp-position-scan-'+key,[scan]);}
      const ids=[...new Set([...scan.ids,...knownIds])];
      await verifyContracts();if(!active())return;
      const initial=await early;if(!active())return;
      const remaining=initial?ids.filter(id=>!knownIds.includes(id)):ids;
      const extra=await readPositionsFast(rpc,remaining,who,epoch,P,tokenIdentityCache);if(!active())return;
      const result={items:[...(initial?.items||[]),...extra.items],failed:(initial?.failed||0)+extra.failed};
      const next=new Map(result.items.map(p=>[p.id,p])),failed=result.failed;
      for(const item of result.items)remember(item.id);
      if(failed){for(const [id,p] of positions)if(!next.has(id))next.set(id,p);}
      positions=next;renderPositions();
      const count=[...positions.values()].filter(p=>p.liquidity>0n).length;
      $('positionsStatus').textContent=count+' RWI position'+(count===1?'':'s')+' · Updated '+new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})+(scan.partial||failed?' · Some data is still syncing; retrying automatically.':' · Updates automatically.');
      if((scan.partial||failed)&&!positions.size)$('positionList').innerHTML='<div class="empty-state">Position history is temporarily incomplete. Checking again automatically…</div>';
      for(const tx of pending.filter(x=>x.account===who.toLowerCase()&&x.status.startsWith('Pending')).slice(0,20))rpc.getTransactionReceipt(tx.hash).then(receipt=>{if(active()&&receipt)updateActivity(tx.hash,receipt.status===1?'Confirmed':'Reverted');}).catch(()=>{});
    }catch{if(active()){$('positionsStatus').textContent='Position data is temporarily unavailable. Retrying automatically.';if(!positions.size)$('positionList').innerHTML='<div class="empty-state">Your positions will appear here when chain data is available.</div>';}}
    finally{if(active()){positionsLoading=null;if(currentView==='positions')positionsTimer=setTimeout(loadPositions,30000);}}
  })();positionsLoading={who,epoch,promise};return promise;
}
async function reviewPosition(id,kind,percentage=100){
  locked(true);try{
    if(!Number.isInteger(percentage)||percentage<1||percentage>100)throw Error('Choose 1% to 100% of the position.');
    const p=await readPosition(id),slip=P.DEFAULT_SLIPPAGE_BPS;await signerFor(p.who,p.epoch);
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
    if(p.kind==='launch'||p.kind==='launchgraduate'||p.kind==='launchfees'||p.kind==='launchbuy'||p.kind==='launchsell'){
      for(const request of await launchesUI.tradeApprovals(p))await send(signer,request,'Approve '+p.symbol+' for sale',p.who,p.epoch);
      const request=await launchesUI.request(p),receipt=await send(signer,request,p.label,p.who,p.epoch);
      clearProposal();view('launch');await launchesUI.load();notice(p.label+' confirmed. The receipt is in Launch → Transaction history.');loadWalletTokens();return;
    }
    let deadline=Math.floor(Date.now()/1000)+1200;
    let call,receipt;
    if(p.kind==='deposit'){
      const provider=injected;
      const batchOptions={onReceipt:r=>activity({hash:r.transactionHash,label:p.label,status:'Confirmed',account:p.who.toLowerCase()})};
      await checkPendingBatch(provider,localStorage,p.who,P.CHAIN,batchOptions);
      const batching=await atomicSupport(provider,p.who,P.CHAIN);
      await signerFor(p.who,p.epoch);
      if(!batching)await approvals(p,signer);
      const fresh=await snapshot(p.live.key,p.live.tokens);
      if(fresh.exists!==p.live.exists)throw Error('The pool changed while approvals were pending. Review the deposit again.');
      deadline=Math.floor(Date.now()/1000)+1200;
      if(p.id){const owned=await readPosition(p.id);if(owned.live.id!==p.live.id||owned.position.tickLower!==p.position.tickLower||owned.position.tickUpper!==p.position.tickUpper)throw Error('The selected position changed. Review it again.');}
      call=P.addCall(p.position,p.who,p.slip,deadline,!p.id&&!p.live.exists,p.id);
      if(batching){
        const calls=await approvalCalls(p);
        if(calls.length){
          notice('Confirm the approvals and deposit together in your wallet. A wallet upgrade may require an additional confirmation.');
          receipt=await sendAtomicBatch(provider,localStorage,p.who,P.CHAIN,[...calls,{to:P.CONTRACTS.manager,data:call.calldata,value:BigInt(call.value)}],{...batchOptions,check:()=>signerFor(p.who,p.epoch)});
        }
      }
    }else{
      const fresh=await readPosition(p.id);
      if(fresh.liquidity!==p.liquidity)throw Error('Your position changed. Review the action again.');
      call=p.kind==='remove'?P.removeCall(p.position,p.id,p.percentage,p.slip,deadline):P.collectCall(p.position,p.id,p.who,deadline);
    }
    if(!receipt)receipt=await send(signer,{to:P.CONTRACTS.manager,data:call.calldata,value:BigInt(call.value)},p.label,p.who,p.epoch);
    if(p.who!==account||p.epoch!==session){clearProposal();notice(p.label+' confirmed for the previous wallet. Switch back to see the updated position.');return;}
    if(p.kind==='deposit'){
      const iface=new Interface(P.MANAGER);
      for(const log of receipt.logs)if(log.address.toLowerCase()===P.CONTRACTS.manager){try{const e=iface.parseLog(log);if(e?.name==='Transfer'&&e.args.from===P.ZERO&&e.args.to.toLowerCase()===p.who.toLowerCase())remember(e.args.tokenId.toString());}catch{}}
    }
    clearProposal();notice(p.label+' confirmed. The receipt is in Launch → Transaction history.');
    if(p.id){const next=await readPosition(p.id,true);positions.set(p.id,next);renderPositions();}
    if(loaded)await loadPool();
    loadWalletTokens();
  }catch(e){clearProposal();notice(failure(e),true);}finally{locked(false);if(account)loadPositions();}
}
function view(name){currentView=name;launchesUI.watch(name==='launch');$('featuredPools').hidden=name!=='add';notice(name==='positions'||name==='launch'?'':'Load a token pair to read its current pool state.');document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===name);b.setAttribute('aria-pressed',String(b.dataset.view===name));});document.querySelectorAll('main>.view').forEach(v=>v.hidden=v.id!==name+'View');$('breadcrumb').textContent=name==='add'?'LP':name==='positions'?'Profile':'Launch';clearTimeout(positionsTimer);if(name==='positions')loadPositions();}
const launchesUI=createLaunchController({rpc,isBusy:()=>busy,getSession:()=>({who:account,epoch:session}),getSigner:signerFor,onFormChange:clearProposal});
$('launchForm').onsubmit=async event=>{event.preventDefault();if(!account){await chooseWallet();return;}locked(true);try{const p=await launchesUI.prepare(account,session);await signerFor(p.who,p.epoch);showReview(p,p.rows);}catch(e){notice(failure(e),true);}finally{locked(false);}};
$('launchForm').addEventListener('input',clearProposal);
$('moreLaunches').onclick=()=>launchesUI.load(true);
$('launchedTokenList').onclick=async event=>{if(busy)return;const trade=event.target.closest('[data-launch-trade]');if(trade){try{await launchesUI.openTrade(trade.dataset.launchTrade);}catch(e){notice(failure(e),true);}return;}const graduate=event.target.closest('[data-launch-graduate]'),button=event.target.closest('[data-launch-fees]');if(!button&&!graduate)return;if(!account){await chooseWallet();return;}locked(true);try{const p=graduate?await launchesUI.graduationReview(graduate.dataset.launchGraduate,account,session):await launchesUI.feeReview(button.dataset.launchFees,account,session);await signerFor(p.who,p.epoch);showReview(p,p.rows);}catch(e){notice(failure(e),true);}finally{locked(false);}};
$('reviewTrade').onclick=async()=>{if(busy)return;if(!account){await chooseWallet();return;}locked(true);try{const p=await launchesUI.prepareTrade(account,session);await signerFor(p.who,p.epoch);showReview(p,p.rows);}catch(e){notice(failure(e),true);}finally{locked(false);}};

document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>view(b.dataset.view));
$('walletButton').onclick=()=>chooseWallet().catch(e=>notice(failure(e),true));
$('disconnect').onclick=()=>{if(injected?.removeListener){injected.removeListener('accountsChanged',oldAccountListener);injected.removeListener('chainChanged',oldChainListener);injected.removeListener('disconnect',oldDisconnectListener);}injected=null;resetWallet();notice('Disconnected from this page. Existing token approvals remain onchain.');};
$('closeWallet').onclick=()=>$('walletDialog').close();$('cancelReview').onclick=clearProposal;$('submitAction').onclick=execute;
$('reviewDialog').addEventListener('cancel',e=>{if(busy)e.preventDefault();else clearProposal();});
$('poolForm').onsubmit=reviewDeposit;$('loadPool').onclick=loadPool;$('tokenAddress').oninput=()=>{clearDepositTarget();invalidate();amountDriver={side:'rwi',percent:0};renderAmountControls();$('tokenAmountLabel').textContent='Token amount (USD)';showSelectedToken();};$('fee').onchange=()=>{invalidate();loadPool();};
['rwi','token'].forEach(side=>$(side+'Percent').addEventListener('input',()=>{clearProposal();amountDriver={side,percent:Number($(side+'Percent').value)};renderAmountControls();}));
$('importPosition').onclick=importPosition;
$('cancelPositionDeposit').onclick=()=>{clearProposal();clearDepositTarget();invalidate();loadPool();};
window.addEventListener('focus',()=>{if(currentView==='positions'&&account&&!busy)loadPositions();});
$('positionList').onclick=e=>{const b=e.target.closest('[data-action]');if(b&&!busy){if(b.dataset.action==='add')addToPosition(b.dataset.id);else if(b.dataset.action==='remove')openWithdrawal(b.dataset.id);else reviewPosition(b.dataset.id,b.dataset.action);}};
$('withdrawPercent').addEventListener('input',updateWithdrawal);
$('closeWithdrawal').onclick=closeWithdrawal;$('cancelWithdrawal').onclick=closeWithdrawal;
$('withdrawDialog').addEventListener('cancel',closeWithdrawal);
$('reviewWithdrawal').onclick=()=>{const choice=withdrawalChoice,percentage=Number($('withdrawPercent').value);if(busy||!choice)return;if(choice.who!==account||choice.epoch!==session){closeWithdrawal();notice('Your wallet changed. Select the position again.',true);return;}if(!Number.isInteger(percentage)||percentage<1||percentage>100)return;closeWithdrawal();reviewPosition(choice.id,'remove',percentage);};
$('copyRwi').onclick=async()=>{try{await navigator.clipboard.writeText(getAddress(P.RWI));notice('RWI contract copied.');}catch{notice('Copy this contract: '+getAddress(P.RWI));}};
$('openTokens').onclick=()=>{if(!account){chooseWallet().catch(e=>notice(failure(e),true));return;}$('tokenSearch').value='';renderWalletTokens();$('tokenDialog').showModal();};
$('closeTokens').onclick=()=>$('tokenDialog').close();$('tokenDialog').addEventListener('close',()=>stopTokenRowLogos());$('refreshTokens').onclick=()=>loadWalletTokens();$('tokenSearch').oninput=renderWalletTokens;
$('walletTokenList').onclick=e=>{const button=e.target.closest('[data-wallet-token]');if(!button||busy)return;const row=walletTokens.find(t=>t.address===button.dataset.walletToken);if(!row)return;clearDepositTarget();invalidate();$('tokenAddress').value=row.address;amountDriver={side:'rwi',percent:0};renderAmountControls();$('tokenAmountLabel').textContent=row.symbol+' amount (USD)';showSelectedToken(row);$('tokenDialog').close();loadPool();};
$('refreshFeatured').onclick=loadFeaturedPools;
loadFeaturedPools();renderAmountControls();renderActivity();loadPool();Promise.resolve().then(restoreWallet);
