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

const $=id=>document.getElementById(id);
const rpc=new JsonRpcProvider('https://rpc.mainnet.chain.robinhood.com',P.CHAIN,{staticNetwork:true,cacheTimeout:-1});
const manager=new Contract(P.CONTRACTS.manager,P.MANAGER,rpc),stateView=new Contract(P.CONTRACTS.state,P.STATE,rpc);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short=s=>s.slice(0,6)+'…'+s.slice(-4);
const fmt=(n,d)=>{const s=formatUnits(n,d);return s.length>24?s.slice(0,24)+'…':s;};
const txLink=hash=>'https://robin.etherscan.io/tx/'+hash;
let injected=null,wallet=null,account=null,session=0,busy=false,loaded=null,proposal=null,verified=false,positions=new Map(),loadSeq=0;
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
let pending=readStore('rwi-lp-transactions',[]);
const discovered=new Map();
let connectionAttempt=0;
const restoredProviders=new WeakSet();
function readStore(k,fallback){try{const v=JSON.parse(localStorage.getItem(k));return Array.isArray(v)?v:fallback;}catch{return fallback;}}
function saveStore(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch{}}
function idsKey(){return 'rwi-lp-positions-'+account?.toLowerCase();}
function remember(id){const ids=readStore(idsKey(),[]);if(!ids.includes(id))saveStore(idsKey(),[id,...ids].slice(0,100));}
function notice(msg,error=false){$('notice').textContent=msg;$('notice').className=error?'notice error':'notice';}
function failure(e){if(e.code===4001||e.code==='ACTION_REJECTED')return 'Request cancelled in your wallet.';return e.shortMessage||e.reason||e.message||'The request failed. Try refreshing the chain data.';}
function locked(v){busy=v;document.querySelectorAll('main input,main select,main button,#walletButton,#disconnect').forEach(el=>el.disabled=v);$('submitAction').disabled=v||!proposal;$('cancelReview').disabled=v;renderAmountControls();}
function clearProposal(){proposal=null;$('reviewDialog').close();}
function invalidate(){loadSeq++;loaded=null;clearProposal();$('poolStatus').textContent='Refresh pool data';$('poolPrice').textContent='—';$('poolId').textContent='—';$('poolLink').hidden=true;$('pairName').textContent='Token / RWI';$('poolBlock').textContent='Load to refresh chain data';}
function resetWallet(){connectionAttempt++;forgetConnector(localStorage);session++;resetTokens();account=null;wallet=null;renderAmountControls();positions.clear();$('walletButton').textContent='Connect wallet';$('disconnect').hidden=true;$('walletStatus').textContent='Connect to see balances and your positions.';$('positionList').innerHTML='<div class="empty-state">Connect your wallet to load your liquidity positions.</div>';clearProposal();renderActivity();}
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
    const [,other]=await Promise.all([verifyContracts(),metadata(address)]);
    if(seq!==loadSeq||epoch!==session)return;
    tokenIdentityCache.set(address,other);showSelectedToken(walletTokens.find(t=>t.address===address)||other);
    const fee=Number($('fee').value),key=P.pair(other,fee);
    const rwi=P.token(P.RWI,18,'RWI'),tokens=key.currency0.toLowerCase()===P.RWI?[rwi,other]:[other,rwi];
    const data=await snapshot(key,tokens);
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
    const image=label.querySelector('img');
    if((image.complete&&image.naturalWidth>=128)||label.dataset.candidates===candidates)return;
  }else{
    label.innerHTML='<span class="selected-token-avatar"><span class="token-monogram">'+esc(token.symbol.slice(0,2))+'</span><img class="selected-token-logo" alt="" referrerpolicy="no-referrer" hidden></span><span class="selected-token-copy"><strong>'+esc(token.symbol)+'</strong><span class="selected-token-name">'+esc(name)+'</span></span>';
  }
  label.dataset.address=address;label.dataset.candidates=candidates;cancelSelectedLogo?.();
  const image=label.querySelector('img');
  cancelSelectedLogo=logoLoader.load(token,result=>{
    if(!label.contains(image)||label.dataset.address!==address)return;
    const display=()=>{if(label.contains(image)&&image.naturalWidth){image.hidden=false;label.querySelector('.token-monogram').hidden=true;}};
    image.onload=display;image.src=result.src;if(image.complete)display();
  });
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
      image.onload=show;image.src=result.src;if(image.complete)show();
    };
    cancel=logoLoader.load({...token,logos:logoMetadataCache.get(token.address)?.logos},display,async()=>{
      const body=await tokenLogoMetadata(token);
      if(current()&&body?.logos.length)cancel=logoLoader.load({...token,logos:body.logos},display);
    });
    cancellations.push(()=>{cancel();image.onload=null;});
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
  const epoch=++session;resetTokens();clearProposal();positions.clear();
  const [accounts,chain]=await Promise.all([provider.request({method:'eth_accounts'}),provider.request({method:'eth_chainId'})]);
  if(epoch!==session||provider!==injected)return;
  if(!accounts.length){resetWallet();return;}
  account=getAddress(accounts[0]);wallet=new BrowserProvider(provider,'any',{cacheTimeout:-1});renderAmountControls();
  $('walletButton').textContent=Number(chain)===P.CHAIN?short(account):'Switch network';$('disconnect').hidden=false;
  $('walletStatus').textContent=Number(chain)===P.CHAIN?'Connected on Robinhood Chain.':'Switch to Robinhood Chain to manage liquidity.';
  $('positionList').innerHTML='<div class="empty-state">Use “Refresh positions” or import a position ID below.</div>';
  renderActivity();
  if(Number(chain)!==P.CHAIN){tokenListMessage='Switch to Robinhood Chain to load your holdings.';$('walletTokenStatus').textContent=tokenListMessage;}
  if(Number(chain)===P.CHAIN){loadWalletTokens();if(loaded)await balances(loaded);else loadPool();}
}
let oldAccountListener,oldChainListener,oldDisconnectListener;
async function connect(provider,restore=false,candidate=null){
  const attempt=++connectionAttempt;
  try{
    const accounts=await provider.request({method:restore?'eth_accounts':'eth_requestAccounts'});
    if(attempt!==connectionAttempt||!accounts?.length)return;
    if(injected?.removeListener){injected.removeListener('accountsChanged',oldAccountListener);injected.removeListener('chainChanged',oldChainListener);injected.removeListener('disconnect',oldDisconnectListener);}
    injected=provider;
    oldAccountListener=()=>syncWallet().catch(e=>notice(failure(e),true));oldChainListener=oldAccountListener;oldDisconnectListener=()=>{resetWallet();notice('Wallet disconnected.');};
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
    const other=data.tokens.find(t=>t.address.toLowerCase()!==P.RWI),r=selectedAmount('rwi'),t=selectedAmount('token');
    const budgets=data.key.currency0.toLowerCase()===P.RWI?[r,t]:[t,r];
    const live=await snapshot(data.key,data.tokens,budgets),slip=P.DEFAULT_SLIPPAGE_BPS;
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
    const p=await readPosition(id),percentage=Number($('withdrawPercent').value),slip=P.DEFAULT_SLIPPAGE_BPS;await signerFor(p.who,p.epoch);
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
function view(name){currentView=name;$('featuredPools').hidden=name!=='add';notice(name==='positions'?(account?'Refresh your positions or import a position ID below.':'Connect your wallet, then refresh or import a position.'):name==='activity'?'Transactions are filtered by your connected wallet.':'Load a token pair to read its current pool state.');document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===name);b.setAttribute('aria-pressed',String(b.dataset.view===name));});document.querySelectorAll('main>.view').forEach(v=>v.hidden=v.id!==name+'View');$('breadcrumb').textContent=name==='add'?'LP':name==='positions'?'My positions':'Transactions';}
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>view(b.dataset.view));
$('walletButton').onclick=()=>chooseWallet().catch(e=>notice(failure(e),true));
$('disconnect').onclick=()=>{if(injected?.removeListener){injected.removeListener('accountsChanged',oldAccountListener);injected.removeListener('chainChanged',oldChainListener);injected.removeListener('disconnect',oldDisconnectListener);}injected=null;resetWallet();notice('Disconnected from this page. Existing token approvals remain onchain.');};
$('closeWallet').onclick=()=>$('walletDialog').close();$('cancelReview').onclick=clearProposal;$('submitAction').onclick=execute;
$('reviewDialog').addEventListener('cancel',e=>{if(busy)e.preventDefault();else clearProposal();});
$('poolForm').onsubmit=reviewDeposit;$('loadPool').onclick=loadPool;$('tokenAddress').oninput=()=>{invalidate();amountDriver={side:'rwi',percent:0};renderAmountControls();$('tokenAmountLabel').textContent='Token amount (USD)';showSelectedToken();};$('fee').onchange=()=>{invalidate();loadPool();};
['rwi','token'].forEach(side=>$(side+'Percent').addEventListener('input',()=>{clearProposal();amountDriver={side,percent:Number($(side+'Percent').value)};renderAmountControls();}));
$('refreshPositions').onclick=refreshPositions;$('importPosition').onclick=importPosition;
$('positionList').onclick=e=>{const b=e.target.closest('[data-action]');if(b&&!busy)reviewPosition(b.dataset.id,b.dataset.action);};
$('copyRwi').onclick=async()=>{try{await navigator.clipboard.writeText(getAddress(P.RWI));notice('RWI contract copied.');}catch{notice('Copy this contract: '+getAddress(P.RWI));}};
$('openTokens').onclick=()=>{if(!account){chooseWallet().catch(e=>notice(failure(e),true));return;}$('tokenSearch').value='';renderWalletTokens();$('tokenDialog').showModal();};
$('closeTokens').onclick=()=>$('tokenDialog').close();$('tokenDialog').addEventListener('close',()=>stopTokenRowLogos());$('refreshTokens').onclick=()=>loadWalletTokens();$('tokenSearch').oninput=renderWalletTokens;
$('walletTokenList').onclick=e=>{const button=e.target.closest('[data-wallet-token]');if(!button||busy)return;const row=walletTokens.find(t=>t.address===button.dataset.walletToken);if(!row)return;invalidate();$('tokenAddress').value=row.address;amountDriver={side:'rwi',percent:0};renderAmountControls();$('tokenAmountLabel').textContent=row.symbol+' amount (USD)';showSelectedToken(row);$('tokenDialog').close();loadPool();};
$('refreshFeatured').onclick=loadFeaturedPools;
loadFeaturedPools();renderAmountControls();renderActivity();loadPool();Promise.resolve().then(restoreWallet);
