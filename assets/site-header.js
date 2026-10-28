(function(){
  const header=document.getElementById('siteHeader');
  if(!header)return;
  const names={en:['Impact','Rewards','Docs','Vote','More'],es:['Impacto','Recompensas','Documentos','Votar','Más'],fr:['Impact','Récompenses','Docs','Voter','Plus'],de:['Wirkung','Prämien','Docs','Abstimmen','Mehr'],pt:['Impacto','Recompensas','Docs','Votar','Mais'],id:['Dampak','Imbalan','Dokumen','Pilih','Lainnya'],tr:['Etki','Ödüller','Belgeler','Oy ver','Diğer'],vi:['Tác động','Phần thưởng','Tài liệu','Bỏ phiếu','Thêm'],ru:['Влияние','Награды','Документы','Голосовать','Ещё'],zh:['影响','奖励','文档','投票','更多'],ja:['活動実績','報酬','ドキュメント','投票','その他'],ko:['성과','보상','문서','투표','더 보기'],hi:['प्रभाव','पुरस्कार','दस्तावेज़','मतदान','अधिक'],ar:['الأثر','المكافآت','المستندات','التصويت','المزيد']};
  function translate(){
    const labels=names[document.documentElement.lang]||names.en;
    header.querySelectorAll('[data-site-label]').forEach(el=>{el.textContent=labels[Number(el.dataset.siteLabel)];});
  }
  translate();
  new MutationObserver(translate).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
  const more=header.querySelector('details');
  document.addEventListener('click',e=>{if(!more.contains(e.target))more.open=false;});
  header.addEventListener('click',e=>{if(e.target.closest('a'))more.open=false;});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&more.open){more.open=false;more.querySelector('summary').focus();}});
  function measure(){document.documentElement.style.setProperty('--site-header-height',header.getBoundingClientRect().height+'px');}
  measure();
  if(typeof ResizeObserver!=='undefined')new ResizeObserver(measure).observe(header);
  else window.addEventListener('resize',measure);
  // Main, docs and vote already supply live tickers. Supply the same display
  // for the claims register and game without duplicating their requests.
  if(!document.body.matches('.site-game,.site-claims'))return;
  const tick=header.querySelector('#ticker');
  function price(value){
    const n=Number(value);if(!Number.isFinite(n)||n<=0)return null;
    if(n>=1)return '$'+n.toFixed(2);if(n>=.01)return '$'+n.toFixed(4);
    const digits=n.toFixed(20).split('.')[1],zeroes=digits.match(/^0*/)[0].length;
    const significant=digits.slice(zeroes,zeroes+3).replace(/0+$/,'')||digits.slice(zeroes,zeroes+3);
    if(zeroes<=2)return '$0.'+digits.slice(0,zeroes+3);
    return '$0.0'+String(zeroes).split('').map(d=>'₀₁₂₃₄₅₆₇₈₉'[Number(d)]).join('')+significant;
  }
  async function update(){
    try{
      const response=await fetch('https://api.dexscreener.com/latest/dex/tokens/0xDa2598c976E62E7E15DcCa75169B404712E48B04');
      if(!response.ok)return;
      const data=await response.json();
      const pairs=(data.pairs||[]).filter(p=>p.chainId==='robinhood'&&p.baseToken?.address?.toLowerCase()==='0xda2598c976e62e7e15dcca75169b404712e48b04'&&p.priceUsd);
      pairs.sort((a,b)=>(b.liquidity?.usd||0)-(a.liquidity?.usd||0));
      const pair=pairs[0],value=price(pair?.priceUsd);if(!value)return;
      const sep=document.createElement('span');sep.className='sep';sep.textContent='· ';
      tick.replaceChildren(sep,document.createTextNode(value));
      const change=Number(pair.priceChange?.h24);
      if(pair.priceChange?.h24!=null&&Number.isFinite(change))tick.append(document.createTextNode(' '+(change>=0?'▲':'▼')+Math.abs(change).toFixed(1)+'%'));
      tick.classList.add('on');
    }catch(error){/* Leave live price empty if the data source is unavailable. */}
  }
  update();setInterval(()=>{if(!document.hidden)update();},30000);
})();
