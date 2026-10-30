import { Contract, Interface, keccak256, randomBytes, hexlify, parseUnits, formatUnits } from 'ethers';
import { LAUNCH_V2_FACTORY as LAUNCH_FACTORY } from './launch-v2-config.js';
import { LAUNCH_V2_ABI as LAUNCH_ABI, LAUNCH_V2_RUNTIME_HASH as LAUNCH_RUNTIME_HASH, LAUNCH_V2_ROUTER_ABI as LAUNCH_ROUTER_ABI, LAUNCH_V2_HOOK_RUNTIME_HASH, LAUNCH_V2_ROUTER_RUNTIME_HASH } from './launch-v2-contract.js';
import { launchMetadata, creatorTax } from './launch-model.js';
import { fetchLaunchQuote, validateLaunchReview, LAUNCH_QUOTE_MAX_AGE } from './launch-pricing.js';
import { createLaunchImageController, verifyLaunchImage } from './launch-image-client.js';
import { createTokenArtwork } from './token-artwork.js';
const $=id=>document.getElementById(id),esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createLaunchController({rpc,isBusy,getSession,getSigner,onFormChange}){
  $('launchActivation').hidden=Boolean(LAUNCH_FACTORY);
  let sequence=0,next=null,rows=[],timer=null;
  let pricing=null,priceSequence=0;
  let tradeToken=null,tradeSide='buy',tradeQuote=null,tradeSequence=0,quoteTimer=null,balanceSequence=0,balanceAccount=null;
  const iface=new Interface(LAUNCH_ABI);
  const renderArtwork=createTokenArtwork();let cardArtwork=[],tradeArtwork=()=>{},reviewArtwork=()=>{};
  const imageUI=createLaunchImageController({getSigner,getSession,onChange:onFormChange,onState:()=>updateDisabled(isBusy())});
  const routerInterface=new Interface(LAUNCH_ROUTER_ABI),RWI='0xda2598c976e62e7e15dcca75169b404712e48b04',ZERO='0x0000000000000000000000000000000000000000',HOOK='0xe5e702641ea86f4ae6cc3cdaed2b886f976be044';
  const quoter=new Contract('0x8dc178efb8111bb0973dd9d722ebeff267c98f94',['function quoteExactInput((address exactCurrency,(address intermediateCurrency,uint24 fee,int24 tickSpacing,address hooks,bytes hookData)[] path,uint128 exactAmount) params) returns(uint256 amountOut,uint256 gasEstimate)'],rpc);
  const dollars=value=>Number(value).toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2});
  async function refreshPricing(fresh=false){
    const request=++priceSequence;
    if(!pricing)$('launchPriceNote').textContent='Reading RWI’s USD price to set the $5,000 starting target…';
    try{const terms=await fetchLaunchQuote(fresh);if(request!==priceSequence){if(fresh)throw Error('The price check changed. Review your launch again.');return null;}pricing=terms;$('launchPriceNote').textContent='Starting target: '+dollars(terms.marketCapUsd)+'. Graduation requires '+Number(formatUnits(terms.graduationThreshold,18)).toLocaleString(undefined,{maximumFractionDigits:0})+' RWI (about $12,500 at this price). RWI’s USD value can change.';updateDisabled(isBusy());return terms;}
    catch(e){if(request===priceSequence){pricing=null;$('launchPriceNote').textContent=e.message;updateDisabled(isBusy());}throw e;}
  }
  async function verify(){
    if(!LAUNCH_FACTORY)throw Error('The launch contract is awaiting its one-time deployment.');
    if(keccak256(await rpc.getCode(LAUNCH_FACTORY))!==LAUNCH_RUNTIME_HASH)throw Error('The launch contract could not be verified. Launching is disabled.');
    const c=new Contract(LAUNCH_FACTORY,LAUNCH_ABI,rpc),[hook,router]=await Promise.all([c.hook(),c.router()]);
    const [hc,rc]=await Promise.all([rpc.getCode(hook),rpc.getCode(router)]);
    if(keccak256(hc)!==LAUNCH_V2_HOOK_RUNTIME_HASH||keccak256(rc)!==LAUNCH_V2_ROUTER_RUNTIME_HASH)throw Error('The launch hook or router could not be verified.');
    return c;
  }
  function updateDisabled(busy){$('reviewLaunch').disabled=busy||!LAUNCH_FACTORY||!imageUI.canReview()||!pricing||Date.now()-pricing.quotedAt>LAUNCH_QUOTE_MAX_AGE;$('moreLaunches').disabled=busy||next===null;$('reviewTrade').disabled=busy||!tradeQuote;if($('tradeDialog').open&&getSession().who!==balanceAccount)refreshTradeBalance();}
  function render(){
    cardArtwork.forEach(cancel=>cancel());cardArtwork=[];
    $('launchedTokenList').innerHTML=rows.length?rows.map(t=>{
      const date=new Date(t.launchedAt*1000).toLocaleDateString([],{month:'short',day:'numeric',year:'numeric'});
      const progress=Math.max(0,Math.min(100,Number(t.quoteReserve)/Number(t.phantomQuote)/2.5*100)),phase=t.phase===2?'UNISWAP V4':t.phase===1?'READY TO GRADUATE':'BONDING CURVE';
      return '<article class="launched-token"><div class="launch-card-title"><span class="token-artwork" data-launch-artwork="'+t.address+'"></span><div><h3>'+esc(t.name)+'</h3><p>'+esc(t.symbol)+' / RWI</p></div><span class="pool-tag">'+phase+'</span></div><p class="launch-description">'+esc(t.description||'A community token paired with RWI.')+'</p>'+(t.phase!==2?'<div class="launch-progress"><label>Graduation <strong>'+progress.toFixed(1)+'%</strong></label><progress value="'+progress+'" max="100" aria-label="RWI raised toward graduation"></progress><small>'+Number(formatUnits(t.quoteReserve,18)).toLocaleString(undefined,{maximumFractionDigits:0})+' of '+Number(formatUnits(BigInt(t.phantomQuote)*5n/2n,18)).toLocaleString(undefined,{maximumFractionDigits:0})+' RWI collected</small></div>':'')+'<dl class="launch-card-details"><dt>Trading fee</dt><dd>1% + '+t.creatorTaxBps/100+'% creator tax</dd><dt>Creator rewards</dt><dd>Claim in ETH</dd><dt>Launched</dt><dd>'+esc(date)+'</dd></dl><a class="launch-address" href="https://robin.etherscan.io/token/'+t.address+'" target="_blank" rel="noopener">'+esc(t.address)+'</a><div class="launch-card-actions">'+(t.phase===1?'<button type="button" class="primary-button" data-launch-graduate="'+t.address+'">Complete graduation</button>':'<button type="button" class="primary-button" data-launch-trade="'+t.address+'">Trade with ETH</button>')+(t.phase===2?'<a class="secondary-button" href="https://app.uniswap.org/explore/pools/robinhood/'+t.poolId+'" target="_blank" rel="noopener">View pool</a>':'')+'<button type="button" class="secondary-button" data-launch-fees="'+t.address+'">Claim ETH rewards</button></div></article>';
    }).join(''):'<div class="empty-state">No tokens have launched through RWI LP yet. Your launch could be the first.</div>';
    $('launchedTokenList').querySelectorAll('[data-launch-artwork]').forEach(host=>{const token=rows.find(t=>t.address===host.dataset.launchArtwork);if(token)cardArtwork.push(renderArtwork(host,token));});
    $('moreLaunches').hidden=next===null;updateDisabled(isBusy());
  }
  async function load(append=false){
    const request=++sequence;$('launchesStatus').textContent=rows.length?'Updating launches…':'Loading the onchain launch registry…';
    try{
      const response=await fetch('/api/lp-launches?version=2'+(append&&next!==null?'&before='+encodeURIComponent(next):''),{signal:AbortSignal.timeout(15000)}),body=await response.json();
      if(request!==sequence)return;if(!response.ok)throw Error(body.error||'Launches could not be loaded.');
      if(body.active===false){rows=[];next=null;render();$('launchesStatus').textContent='Preview · Launching opens after the one-time contract deployment.';return;}
      if(body.factory?.toLowerCase()!==LAUNCH_FACTORY?.toLowerCase()||!Array.isArray(body.launches))throw Error('The launch registry could not be verified.');
      const clean=body.launches.filter(t=>/^0x[0-9a-f]{40}$/.test(t.address)&&/^0x[0-9a-f]{64}$/.test(t.poolId)&&typeof t.name==='string'&&typeof t.symbol==='string'&&typeof t.description==='string'&&Number.isFinite(t.launchedAt)&&[0,1,2].includes(t.phase)&&[0,100,200,300].includes(t.creatorTaxBps)&&/^\d{1,40}$/.test(t.phantomQuote)&&BigInt(t.phantomQuote)>0n&&/^\d{1,40}$/.test(t.quoteReserve));
      const cursor=typeof body.next==='string'&&/^\d{1,10}$/.test(body.next)?body.next:null;
      next=append||!rows.length?cursor:next===null||cursor===null?null:String(Math.min(Number(next),Number(cursor)));
      const fresh=new Map(clean.map(t=>[t.address,t]));
      rows=append?[...new Map([...rows,...clean].map(t=>[t.address,t])).values()]:[...fresh.values(),...rows.filter(t=>!fresh.has(t.address))];render();
      $('launchesStatus').textContent=body.total+' token'+(body.total===1?'':'s')+' launched · Verified onchain · Newest first';
    }catch(e){if(request===sequence)$('launchesStatus').textContent=e.message;}
  }
  function watch(active){clearTimeout(timer);if(active){load();if(!isBusy())refreshPricing().catch(()=>{});timer=setTimeout(()=>watch(true),30000);}}
  async function prepare(who,epoch){
    const metadata=launchMetadata({...Object.fromEntries(['name','symbol','description','website','twitter','telegram'].map(key=>[key,$('launch'+key[0].toUpperCase()+key.slice(1)).value])),logo:''});
    const tax=creatorTax($('launchCreatorTax').value);await verify();metadata.logo=await imageUI.prepare(who,epoch);const terms=await refreshPricing(true);
    return {kind:'launch',who,epoch,metadata,terms,tax,salt:hexlify(randomBytes(32)),createdAt:Date.now(),label:'Launch '+metadata.symbol,rows:[['Token',metadata.name+' ('+metadata.symbol+')'],['Pair','RWI'],['Supply','1,000,000,000'],['Starting market cap target','$5,000.00'],['Starting price',terms.price+' RWI per token'],['RWI price reference','$'+terms.rwiPriceUsd+' · GeckoTerminal'],['Price review','Valid for 2 minutes; rechecked before signing'],['Curve','Pons v2 constant-product shape'],['Graduation target',formatUnits(terms.graduationThreshold,18)+' RWI'],['Base trading fee','1%'],['Additional creator tax',tax/100+'% · Fixed at launch'],['Creator rewards','ETH only; claimed on demand'],['Launch fee','0 ETH'],['RWI deposit','None'],['Graduated liquidity','Full-range Uniswap v4 · Permanently locked'],['Creator / fee recipient',who],['Network cost','Wallet gas estimate'],['Factory',LAUNCH_FACTORY]]};
  }
  async function feeReview(token,who,epoch){const c=await verify(),record=await c.launches(token);if(record.creator.toLowerCase()!==who.toLowerCase())throw Error('Connect the creator wallet to claim rewards for this token.');if(await c.rewardRwi(token)===0n)throw Error('No creator rewards have accrued yet.');const out=await c.claimRewards.staticCall(token,1n,Math.floor(Date.now()/1000)+120,{from:who}),minimum=out*9950n/10000n;if(minimum===0n)throw Error('Rewards are too small to convert yet.');return {kind:'launchfees',who,epoch,token,minimum,createdAt:Date.now(),label:'Claim ETH rewards',rows:[['Token',token],['Recipient',who],['Estimated reward',formatUnits(out,18)+' ETH'],['Minimum received',formatUnits(minimum,18)+' ETH'],['Conversion','Accrued RWI fees to ETH'],['Slippage','0.5%'],['Locked liquidity','Unchanged']]};}
  async function graduationReview(token,who,epoch){const c=await verify(),record=await c.launches(token);if(record.phase!==1n)throw Error('This launch is not waiting for graduation.');return {kind:'launchgraduate',who,epoch,token,createdAt:Date.now(),label:'Complete graduation',rows:[['Token',token],['Action','Create permanently locked Uniswap v4 liquidity'],['Funds supplied by you','None'],['Network cost','Wallet gas estimate']]};}
  async function route(){const factory=await verify(),address=await factory.router(),router=new Contract(address,LAUNCH_ROUTER_ABI,rpc);if((await router.factory()).toLowerCase()!==LAUNCH_FACTORY.toLowerCase())throw Error('The ETH routing contract could not be verified.');return address;}
  function refreshTrade(){
    tradeQuote=null;tradeSequence++;clearTimeout(quoteTimer);updateDisabled(isBusy());if(!tradeToken)return;
    $('tradeAmountLabel').textContent=tradeSide==='buy'?'Spend ETH':'Sell '+tradeToken.symbol;$('tradeOutputLabel').textContent=tradeSide==='buy'?'Estimated '+tradeToken.symbol+' received':'Estimated ETH received';
    $('tradeRoute').textContent=tradeSide==='buy'?'ETH to RWI to '+tradeToken.symbol:tradeToken.symbol+' to RWI to ETH';
    document.querySelectorAll('[data-trade-side]').forEach(button=>{button.classList.toggle('active',button.dataset.tradeSide===tradeSide);button.setAttribute('aria-pressed',String(button.dataset.tradeSide===tradeSide));});
    $('tradeOutput').textContent='—';$('tradeOutput').title='';$('tradeQuoteStatus').textContent='Reading the current curve or pool quote…';quoteTimer=setTimeout(quoteTrade,350);
  }
  async function quoteTrade(){
    const token=tradeToken,side=tradeSide,request=++tradeSequence;if(!token||!$('tradeDialog').open)return;
    try{
      const text=$('tradeAmount').value.trim();if(!/^\d{1,18}(?:\.\d{1,18})?$/.test(text))throw Error('Enter a positive amount.');const amount=parseUnits(text,18);if(amount<=0n||amount>=(1n<<127n))throw Error('Enter a smaller positive amount.');
      const factory=await verify(),record=await factory.launches(token.address);let out,partial=false,rwiWanted=0n;
      if(record.phase===1n)throw Error('This curve is sold out. Complete graduation to resume trading.');
      const rwiHop={intermediateCurrency:RWI,fee:0,tickSpacing:200,hooks:HOOK,hookData:'0x'},ethHop={...rwiHop,intermediateCurrency:ZERO};
      if(record.phase===0n){
        if(side==='buy'){const [rwiOut]=await quoter.quoteExactInput.staticCall({exactCurrency:ZERO,path:[rwiHop],exactAmount:amount});rwiWanted=rwiOut*9950n/10000n;const curve=await factory.quoteBuy(token.address,rwiWanted);out=curve[0];partial=curve[1]<rwiWanted;}
        else{const [rwiOut]=await factory.quoteSell(token.address,amount);[out]=await quoter.quoteExactInput.staticCall({exactCurrency:RWI,path:[ethHop],exactAmount:rwiOut});}
      }else{
        const hook=await factory.hook(),path=side==='buy'?[rwiHop,{intermediateCurrency:token.address,fee:0,tickSpacing:200,hooks:hook,hookData:'0x'}]:[{intermediateCurrency:RWI,fee:0,tickSpacing:200,hooks:hook,hookData:'0x'},ethHop];
        [out]=await quoter.quoteExactInput.staticCall({exactCurrency:side==='buy'?ZERO:token.address,path,exactAmount:amount});
      }
      const minimum=out*9950n/10000n;
      if(request!==tradeSequence||token!==tradeToken||side!==tradeSide||!$('tradeDialog').open)return;if(minimum<=0n)throw Error('The trade is too small to quote.');
      tradeQuote={token:token.address,symbol:token.symbol,side,amount,out,minimum,partial,rwiWanted,tax:Number(record.creatorTaxBps),phase:Number(record.phase),at:Date.now()};
      const output=formatUnits(out,18),symbol=side==='buy'?token.symbol:'ETH';$('tradeOutput').textContent=Number(output).toLocaleString(undefined,{maximumSignificantDigits:9})+' '+symbol;$('tradeOutput').title=output+' '+symbol;$('tradeQuoteStatus').textContent='Includes 1% base fee + '+Number(record.creatorTaxBps)/100+'% creator tax and the ETH/RWI route fee. Automatic 0.5% slippage protection.'+(record.phase===0n&&side==='buy'?' Unspent ETH is returned automatically.':'')+(partial?' This buy finishes the curve; only the remaining allocation is purchased.':'');updateDisabled(isBusy());
    }catch(e){if(request===tradeSequence){tradeQuote=null;$('tradeOutput').textContent='Unavailable';$('tradeQuoteStatus').textContent=e.action?'This route cannot be quoted right now. Try a smaller amount or check again.':e.message;updateDisabled(isBusy());}}
  }
  async function refreshTradeBalance(){
    const current=tradeToken,side=tradeSide,request=++balanceSequence,{who}=getSession();balanceAccount=who;$('tradeBalance').textContent=who?'Reading your balance…':'Connect your wallet before trading.';
    if(!who||!current)return;
    try{const balance=side==='buy'?await rpc.getBalance(who):await new Contract(current.address,['function balanceOf(address) view returns(uint256)'],rpc).balanceOf(who);if(request===balanceSequence&&current===tradeToken&&who===getSession().who)$('tradeBalance').textContent=(side==='buy'?'ETH':current.symbol)+' available: '+formatUnits(balance,18)+(side==='buy'?' · Leave ETH for network gas.':'');}catch{if(request===balanceSequence)$('tradeBalance').textContent='Balance unavailable. It will be checked before review.';}
  }
  async function openTrade(token){
    tradeToken=rows.find(t=>t.address===token);if(!tradeToken)throw Error('This token is not in the verified launch registry.');tradeArtwork();tradeArtwork=renderArtwork($('tradeTokenArtwork'),tradeToken);tradeSide='buy';$('tradeTitle').textContent='Trade '+tradeToken.symbol;$('tradeAmount').value='0.001';$('tradeDialog').showModal();refreshTrade();
    refreshTradeBalance();
  }
  async function prepareTrade(who,epoch){
    if(!tradeQuote||Date.now()-tradeQuote.at>20000)await quoteTrade();if(!tradeQuote)throw Error('Wait for a valid trade quote.');
    const q={...tradeQuote},router=await route(),token=new Contract(q.token,['function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)'],rpc);
    const balance=q.side==='buy'?await rpc.getBalance(who):await token.balanceOf(who);if(balance<q.amount)throw Error('Your wallet does not have enough '+(q.side==='buy'?'ETH':q.symbol)+'.');
    $('tradeDialog').close();
    return {kind:q.side==='buy'?'launchbuy':'launchsell',who,epoch,token:q.token,symbol:q.symbol,amount:q.amount,minimum:q.minimum,rwiWanted:q.rwiWanted,router,quotedAt:q.at,createdAt:Date.now(),label:q.side==='buy'?'Buy '+q.symbol:'Sell '+q.symbol,rows:[['Route',q.side==='buy'?'ETH to RWI to '+q.symbol:q.symbol+' to RWI to ETH'],['Spend up to',formatUnits(q.amount,18)+' '+(q.side==='buy'?'ETH':q.symbol)],['Minimum received',formatUnits(q.minimum,18)+' '+(q.side==='buy'?q.symbol:'ETH')],['Slippage','0.5%'],['Launch trading fees','1% base + '+q.tax/100+'% creator tax'],['Routing fee','ETH/RWI pool fees included'],...(q.phase===0&&q.side==='buy'?[['Unspent ETH','Returned directly to your wallet']]:[]),...(q.partial?[['Final curve buy','Purchases only the remaining allocation, then graduates']]:[]),...(q.side==='sell'?[['Token approval','Exact amount being sold; remains if you cancel the sale']]:[]),['Token',q.token],['Recipient',who],['Router',router]]};
  }
  async function tradeApprovals(p){if(p.kind!=='launchsell')return [];const token=new Contract(p.token,['function allowance(address,address) view returns(uint256)','function approve(address,uint256) returns(bool)'],rpc);return await token.allowance(p.who,p.router)>=p.amount?[]:[{to:p.token,data:token.interface.encodeFunctionData('approve',[p.router,p.amount]),value:0n}];}
  async function request(p){
    await verify();
    if(p.kind==='launchbuy'||p.kind==='launchsell'){
      if(Date.now()-p.quotedAt>120000)throw Error('The trade quote expired. Review a fresh quote.');if((await route()).toLowerCase()!==p.router.toLowerCase())throw Error('The routing contract changed. Review the trade again.');
      return {to:p.router,data:routerInterface.encodeFunctionData(p.kind==='launchbuy'?'buy':'sell',p.kind==='launchbuy'?[p.token,p.rwiWanted,p.minimum,Math.floor(Date.now()/1000)+120]:[p.token,p.amount,p.minimum,Math.floor(Date.now()/1000)+120]),value:p.kind==='launchbuy'?p.amount:0n};
    }
    if(p.kind==='launch'){
      if(p.metadata.logo)await verifyLaunchImage(p.metadata.logo);
      validateLaunchReview(p.terms,await refreshPricing(true));
    }
    if(p.kind==='launchfees'&&Date.now()-p.createdAt>120000)throw Error('The reward quote expired. Review a fresh ETH claim.');
    return {to:LAUNCH_FACTORY,data:p.kind==='launch'?iface.encodeFunctionData('launch',[p.metadata,p.terms.phantomQuote,creatorTax(p.tax),p.salt,Math.floor(Date.now()/1000)+120]):p.kind==='launchgraduate'?iface.encodeFunctionData('graduate',[p.token]):iface.encodeFunctionData('claimRewards',[p.token,p.minimum,Math.floor(Date.now()/1000)+120]),value:0n};
  }
  function renderReview(p){reviewArtwork();const token=p.kind==='launch'?{...p.metadata}:rows.find(t=>t.address===p.token);$('reviewTokenArtwork').hidden=!token;if(token)reviewArtwork=renderArtwork($('reviewTokenArtwork'),token);}
  $('reviewDialog').addEventListener('close',()=>reviewArtwork());
  $('tradeAmount').addEventListener('input',refreshTrade);document.querySelectorAll('[data-trade-side]').forEach(button=>button.onclick=()=>{tradeSide=button.dataset.tradeSide;$('tradeAmount').value=tradeSide==='buy'?'0.001':'';refreshTrade();refreshTradeBalance();});
  $('closeTrade').onclick=()=>$('tradeDialog').close();$('cancelTrade').onclick=()=>$('tradeDialog').close();$('tradeDialog').addEventListener('close',()=>{tradeArtwork();tradeSequence++;clearTimeout(quoteTimer);tradeQuote=null;});
  updateDisabled(false);
  return {load,watch,prepare,request,renderReview,feeReview,graduationReview,updateDisabled,openTrade,prepareTrade,tradeApprovals};
}
