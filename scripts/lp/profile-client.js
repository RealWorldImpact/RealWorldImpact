import { Contract, formatUnits } from 'ethers';
import * as P from './protocol.js';
import { LAUNCH_V2_FACTORY } from './launch-v2-config.js';
import { LAUNCH_V2_ABI } from './launch-v2-contract.js';
import { createTokenArtwork } from './token-artwork.js';
import { readWalletHoldings } from './wallet-balances.js';
import { sortHoldings, usdLabel } from './wallet-tokens.js';
import { creatorLaunches, ownsProfile, profileAddress, profileLink, sumKnown } from './profile-model.js';

const $=id=>document.getElementById(id),esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short=a=>a.slice(0,6)+'…'+a.slice(-4),eth=n=>Number(formatUnits(n,18)).toLocaleString('en-US',{maximumSignificantDigits:7})+' ETH';
export function createProfileController({rpc,getSubject,getAccount,isBusy,onNavigate,onConnect,onLaunch,onClaim}){
  let subject=null,generation=0,visible=false,timer=null,inflight=null,launches=[],launchesLoaded=false,rewards=new Map(),cancelArtwork=[],holdings=[],cancelHoldings=[];
  const artwork=createTokenArtwork(),factory=new Contract(LAUNCH_V2_FACTORY,LAUNCH_V2_ABI,rpc);
  const current=(who,epoch)=>who===subject&&epoch===generation;
  function identity(){
    const owner=ownsProfile(subject,getAccount());
    $('profileTitle').textContent=subject?owner?'Your profile':short(subject):'Your wallet. Your impact.';
    $('profileAddress').textContent=subject||'Connect a wallet or explore a public profile.';
    $('profileAvatar').textContent=subject?subject.slice(2,4).toUpperCase():'RWI';
    $('profileBadge').textContent=subject?'PUBLIC PROFILE · ROBINHOOD CHAIN':'ROBINHOOD CHAIN';
    $('profileShare').hidden=!subject;$('profileCopy').hidden=!subject;$('profileExplorer').hidden=!subject;
    if(subject)$('profileExplorer').href='https://robin.etherscan.io/address/'+subject;
    $('profileConnect').hidden=Boolean(getAccount());$('profileOwn').hidden=!getAccount()||owner;
    $('profileLaunch').hidden=!owner;$('profileActivityPanel').hidden=!owner;
    $('profilePositionsTitle').textContent=owner||!subject?'My positions':'Liquidity positions';
    $('profileImport').hidden=!owner;
    $('profileClaimHelp').textContent=owner?'Claim each launch’s accrued rewards in ETH. Your wallet reviews every claim.':subject?'Launches and rewards are public. Only the creator wallet can claim.':'Connect your creator wallet to manage launches and claim ETH rewards.';
    if(document.activeElement!==$('profileLookupAddress'))$('profileLookupAddress').value=subject||'';
  }
  function stat(id,value,note){$(id).textContent=value;$(id+'Note').textContent=note;}
  function renderLaunches(){
    cancelArtwork.forEach(fn=>fn());cancelArtwork=[];
    const owner=ownsProfile(subject,getAccount());
    $('profileLaunchList').innerHTML=launches.length?launches.map(t=>{
      const reward=rewards.get(t.address),pending=BigInt(t.rewardRwi)>0n,progress=Math.max(0,Math.min(100,Number(t.quoteReserve)/Number(t.phantomQuote)*40));
      const amount=reward===undefined?'Checking rewards…':reward===null?'Quote available on claim':eth(reward);
      return '<article class="launched-token profile-launch-card"><div class="launch-card-title"><span class="token-artwork" data-profile-artwork="'+t.address+'"></span><div><h3>'+esc(t.name)+'</h3><p>'+esc(t.symbol)+' / RWI</p></div><span class="pool-tag">'+(t.phase===2?'UNISWAP V4':t.phase===1?'READY TO GRADUATE':'BONDING CURVE')+'</span></div><p class="launch-description">'+esc(t.description||'A community token paired with RWI.')+'</p>'+(t.phase!==2?'<div class="launch-progress"><label>Graduation <strong>'+progress.toFixed(1)+'%</strong></label><progress value="'+progress+'" max="100" aria-label="Graduation progress"></progress></div>':'')+'<div class="profile-reward"><span>UNCLAIMED CREATOR REWARDS</span><strong>'+esc(amount)+'</strong><small>'+(!pending?'No rewards accrued yet.':'Estimated ETH after conversion. Final amount is checked at claim.')+'</small></div><div class="profile-launch-meta"><span>'+Number(t.creatorTaxBps)/100+'% creator fee</span><span>'+esc(new Date(t.launchedAt*1000).toLocaleDateString())+'</span></div><div class="profile-launch-actions"><a class="secondary-button" href="https://robin.etherscan.io/token/'+t.address+'" target="_blank" rel="noopener">View token</a>'+(owner?'<button type="button" class="primary-button" data-profile-claim="'+t.address+'" '+(isBusy()||!pending?'disabled':'')+'>'+(pending?'Claim ETH rewards':'No rewards yet')+'</button>':'<span class="help">Creator wallet required to claim</span>')+'</div></article>';
    }).join(''):'<div class="empty-state">'+(subject?launchesLoaded?'No launches found for this wallet.':'Loading this wallet’s launches…':'Explore a wallet to see its launches, or connect yours to get started.')+'</div>';
    $('profileLaunchList').querySelectorAll('[data-profile-artwork]').forEach(host=>{const t=launches.find(t=>t.address===host.dataset.profileArtwork);if(t)cancelArtwork.push(artwork(host,t));});
    const count=launches.filter(t=>BigInt(t.rewardRwi)>0n).length,values=launches.map(t=>rewards.get(t.address)??null),total=sumKnown(values);
    stat('profileRewardsValue',subject?(launchesLoaded?(total.partial?(total.value>0n?'≈ '+eth(total.value)+' +':'Quote on claim'):eth(total.value)):'—'):'—',subject?launchesLoaded?count+' launch'+(count===1?'':'es')+' with rewards'+(total.partial?' · Some quotes unavailable':' · Estimated payout'):'Checking launch history…':'Creator rewards are paid in ETH');
    $('profileLaunchCount').textContent=subject&&!launchesLoaded?launches.length+' found · Checking history':launches.length+' launch'+(launches.length===1?'':'es');
  }
  function renderHoldings(partial=false){
    cancelHoldings.forEach(fn=>fn());cancelHoldings=[];
    const total=sumKnown(holdings.map(t=>t.valueUsd));
    stat('profileWalletValue',usdLabel(total.value)+(partial||total.partial?' +':''),partial||total.partial?'Known value · Some assets or prices unavailable':'Estimated wallet assets · Excludes liquidity');
    $('profileHoldingsList').innerHTML=holdings.length?holdings.map(t=>'<a class="profile-holding" href="https://robin.etherscan.io/'+(t.address===P.ZERO?'address/'+subject:'token/'+t.address)+'" target="_blank" rel="noopener"><span class="token-artwork" data-holding-artwork="'+t.address+'"></span><span class="profile-holding-name"><strong>'+esc(t.symbol)+'</strong><small>'+esc(t.name)+'</small></span><span class="profile-holding-value"><strong>'+esc(usdLabel(t.valueUsd))+'</strong><small>'+Number(formatUnits(t.balance,t.decimals)).toLocaleString('en-US',{maximumSignificantDigits:7})+' '+esc(t.symbol)+'</small></span></a>').join(''):'<div class="empty-state">'+(partial?'Holdings could not be fully loaded. Retrying automatically.':'No supported token balances found.')+'</div>';
    $('profileHoldingsList').querySelectorAll('[data-holding-artwork]').forEach(host=>{const t=holdings.find(t=>t.address===host.dataset.holdingArtwork);if(t)cancelHoldings.push(artwork(host,{...t,address:t.address===P.ZERO?P.WETH:t.address}));});
  }
  async function loadHoldings(who,epoch){
    const [portfolio,native,base,prices]=await Promise.allSettled([
      fetch('/api/lp-wallet-tokens?address='+who.toLowerCase(),{signal:AbortSignal.timeout(18000)}).then(async r=>{if(!r.ok)throw Error('Holdings unavailable');const body=await r.json();if(!Array.isArray(body.tokens))throw Error('Invalid holdings');const tokens=body.tokens.filter(t=>profileAddress(t.address)&&t.address.toLowerCase()!==P.RWI&&t.address.toLowerCase()!==P.ZERO);const result=await readWalletHoldings(tokens,who,tx=>rpc.call(tx));return {rows:result.rows,partial:body.partial||result.failed>0};}),
      rpc.getBalance(who),new Contract(P.RWI,['function balanceOf(address) view returns(uint256)'],rpc).balanceOf(who),
      fetch('/api/lp-token-prices?addresses='+P.RWI+','+P.WETH,{signal:AbortSignal.timeout(10000)}).then(async r=>{if(!r.ok)throw Error('Prices unavailable');return (await r.json()).prices;})
    ]);
    if(!current(who,epoch))return;
    const quote=prices.status==='fulfilled'&&prices.value?prices.value:{},rows=portfolio.status==='fulfilled'?portfolio.value.rows:[];
    if(native.status==='fulfilled')rows.push({address:P.ZERO,symbol:'ETH',name:'Ether',decimals:18,balance:native.value,priceUsd:quote[P.WETH]??null});
    if(base.status==='fulfilled')rows.push({address:P.RWI,symbol:'RWI',name:'Real World Impact',decimals:18,balance:base.value,priceUsd:quote[P.RWI]??null});
    holdings=sortHoldings([...new Map(rows.map(t=>[t.address.toLowerCase(),t])).values()]);
    const partial=[portfolio,native,base].some(r=>r.status==='rejected')||portfolio.value?.partial;
    renderHoldings(partial);$('profileHoldingsStatus').textContent=(partial?'Some holdings are unavailable. Retrying automatically. ':'')+'USD estimates · Highest value first · Updated '+new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  }
  async function loadLaunches(who,epoch){
    let next=null;const found=[],seen=new Set();
    $('profileLaunchStatus').textContent=launches.length?'Updating launches and rewards…':'Finding this wallet’s launches…';
    try{
      do{
        const response=await fetch('/api/lp-launches?version=2&creator='+who.toLowerCase()+(next?'&before='+next:''),{signal:AbortSignal.timeout(20000)}),body=await response.json();
        if(!current(who,epoch))return;
        if(!response.ok||body.factory?.toLowerCase()!==LAUNCH_V2_FACTORY.toLowerCase()||!Array.isArray(body.launches))throw Error('Launch registry unavailable.');
        found.push(...creatorLaunches(body.launches,who));
        if(body.next!==null&&(typeof body.next!=='string'||!/^\d{1,10}$/.test(body.next)||seen.has(body.next)||next!==null&&Number(body.next)>=Number(next)))throw Error('Launch history is incomplete.');
        next=body.next;if(next)seen.add(next);
        launches=creatorLaunches(found,who);launchesLoaded=next===null;renderLaunches();
        $('profileLaunchStatus').textContent=next?'Checking older launches… '+launches.length+' found.':'All launches loaded · Rewards update automatically';
      }while(next&&current(who,epoch));
      const quotes=new Map();
      // Read-only simulations quote the ETH payout without asking for a signature.
      for(let i=0;i<launches.length;i+=6){
        const batch=launches.slice(i,i+6);
        const results=await Promise.allSettled(batch.map(t=>BigInt(t.rewardRwi)===0n?Promise.resolve(0n):factory.claimRewards.staticCall(t.address,1n,Math.floor(Date.now()/1000)+120,{from:who})));
        if(!current(who,epoch))return;
        batch.forEach((t,j)=>quotes.set(t.address,results[j].status==='fulfilled'?results[j].value:null));
      }
      rewards=quotes;renderLaunches();
    }catch{if(current(who,epoch)){$('profileLaunchStatus').textContent='Launch data is incomplete or temporarily unavailable. Retrying automatically.';stat('profileRewardsValue','Unavailable','Reward data will update automatically.');$('profileLaunchList').innerHTML=launches.length?$('profileLaunchList').innerHTML:'<div class="empty-state">Launches will appear when the registry is available.</div>';}}
  }
  function sync(){
    const next=getSubject();if(next!==subject){subject=next;generation++;inflight=null;launches=[];launchesLoaded=false;rewards.clear();holdings=[];cancelArtwork.forEach(fn=>fn());cancelHoldings.forEach(fn=>fn());
      for(const id of ['profileWalletValue','profileLiquidityValue','profileFeesValue','profileRewardsValue'])stat(id,'—',subject?'Loading onchain data…':'Connect a wallet or view a public address');
      $('profileHoldingsList').innerHTML='<div class="empty-state">'+(subject?'Loading wallet holdings…':'Wallet holdings appear here.')+'</div>';$('profileHoldingsStatus').textContent='';$('profileLaunchStatus').textContent='';renderLaunches();
    }
    identity();renderLaunches();updateDisabled();if(visible)load();
  }
  function updateDisabled(){document.querySelectorAll('[data-profile-claim]').forEach(b=>{const t=launches.find(t=>t.address===b.dataset.profileClaim);b.disabled=isBusy()||!ownsProfile(subject,getAccount())||!t||BigInt(t.rewardRwi)===0n;});}
  async function load(){
    if(!subject||!visible||isBusy())return;if(inflight)return inflight;
    const who=subject,epoch=generation;
    const work=Promise.allSettled([loadHoldings(who,epoch),loadLaunches(who,epoch)]);inflight=work;await work;
    if(current(who,epoch))inflight=null;
  }
  function watch(active){visible=active;clearTimeout(timer);if(active){sync();timer=setTimeout(()=>watch(true),45000);}}
  async function copy(value,message){try{await navigator.clipboard.writeText(value);$('profileMessage').textContent=message;}catch{$('profileMessage').textContent=value;}}
  $('profileShare').onclick=()=>copy(profileLink(subject,location.origin),'Public profile link copied.');
  $('profileCopy').onclick=()=>copy(subject,'Wallet address copied.');
  $('profileConnect').onclick=onConnect;$('profileOwn').onclick=()=>onNavigate(null);$('profileLaunch').onclick=onLaunch;
  $('profileLookup').onsubmit=e=>{e.preventDefault();const address=profileAddress($('profileLookupAddress').value.trim());if(!address){$('profileMessage').textContent='Enter a valid 0x wallet address.';return;}$('profileMessage').textContent='';onNavigate(address);};
  $('profileLaunchList').onclick=e=>{const b=e.target.closest('[data-profile-claim]');if(b&&!b.disabled&&!isBusy()&&ownsProfile(subject,getAccount())){const token=launches.find(t=>t.address===b.dataset.profileClaim);if(token)onClaim(token.address,token);}};
  function positionsSummary(rows,fees,complete){
    for(const [id,values,note] of [['profileLiquidityValue',rows.map(r=>r.valueUsd),'Estimated principal · Fees excluded'],['profileFeesValue',fees.map(r=>r.valueUsd),ownsProfile(subject,getAccount())?'Uncollected LP fees · Collect below':'Uncollected fees earned by these positions']]){
      const total=sumKnown(values);stat(id,usdLabel(total.value)+(total.partial||!complete?' +':''),total.partial||!complete?'Known value · Some position data unavailable':note);
    }
  }
  return {sync,watch,load,updateDisabled,positionsSummary};
}
