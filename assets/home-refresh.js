/* Progressive enhancement: the complete donation history remains in the HTML. */
(function(){
  const list=document.getElementById('receiptList');
  const toggle=document.getElementById('receiptsToggle');
  let expanded=false;
  const labels={en:['View all receipts','Show recent receipts','Impact','Rewards','More','RWI revenue','40% to The Index','Of the 40% allocated to The Index'],es:['Ver todos los recibos','Mostrar recibos recientes','Impacto','Recompensas','Más','Ingresos de RWI','40% a The Index','Del 40% asignado a The Index'],fr:['Voir tous les reçus','Voir les reçus récents','Impact','Récompenses','Plus','Revenus RWI','40% vers The Index','Sur les 40% alloués à The Index'],de:['Alle Belege anzeigen','Aktuelle Belege anzeigen','Wirkung','Prämien','Mehr','RWI-Einnahmen','40% an The Index','Von den 40% für The Index'],pt:['Ver todos os recibos','Mostrar recibos recentes','Impacto','Recompensas','Mais','Receita RWI','40% para The Index','Dos 40% alocados ao The Index'],id:['Lihat semua tanda terima','Tampilkan yang terbaru','Dampak','Imbalan','Lainnya','Pendapatan RWI','40% ke The Index','Dari 40% yang dialokasikan ke The Index'],tr:['Tüm makbuzlar','Son makbuzlar','Etki','Ödüller','Diğer','RWI geliri',"The Index’e %40",'The Index’e ayrılan %40 içinden'],vi:['Xem tất cả biên nhận','Xem biên nhận gần đây','Tác động','Phần thưởng','Thêm','Doanh thu RWI','40% đến The Index','Trong 40% phân bổ cho The Index'],ru:['Все квитанции','Последние квитанции','Влияние','Награды','Ещё','Доход RWI','40% в The Index','Из 40%, выделенных The Index'],zh:['查看所有收据','显示近期收据','影响','奖励','更多','RWI 收入','40% 分配给 The Index','在分配给 The Index 的 40% 中'],ja:['すべての領収書','最近の領収書','活動実績','報酬','その他','RWIの収益','40%をThe Indexへ','The Indexに割り当てた40%の内訳'],ko:['모든 영수증 보기','최근 영수증 보기','성과','보상','더 보기','RWI 수익','The Index에 40%','The Index에 배정된 40%의 내역'],hi:['सभी रसीदें देखें','हाल की रसीदें','प्रभाव','पुरस्कार','अधिक','RWI राजस्व','The Index को 40%','The Index को आवंटित 40% में से'],ar:['عرض جميع الإيصالات','عرض أحدث الإيصالات','الأثر','المكافآت','المزيد','إيرادات RWI','40% إلى The Index','من نسبة 40% المخصصة إلى The Index']};
  function paint(){
    const text=labels[document.documentElement.lang]||labels.en;
    document.querySelectorAll('[data-refresh-label]').forEach(el=>{el.textContent=text[Number(el.dataset.refreshLabel)];});
    if(!list||!toggle)return;
    const rows=[...list.querySelectorAll('.receipt')];
    rows.forEach((row,i)=>{row.hidden=!expanded&&i>=5;});
    toggle.hidden=rows.length<=5;
    toggle.textContent=text[expanded?1:0]+(expanded?'':' ('+rows.length+')');
    toggle.setAttribute('aria-expanded',String(expanded));
  }
  if(toggle)toggle.addEventListener('click',()=>{
    const collapsing=expanded;
    const buttonTop=toggle.getBoundingClientRect().top;
    const root=document.documentElement;
    const anchorStyle=root.style.overflowAnchor;
    if(collapsing)root.style.overflowAnchor='none';
    expanded=!expanded;
    paint();
    // Keep the clicked control in the same viewport position as the history
    // shrinks. scrollIntoView instead moved it to an arbitrary viewport edge,
    // with the page's smooth scrolling making that jump more disorienting.
    if(collapsing){
      const restorePosition=()=>window.scrollBy({top:toggle.getBoundingClientRect().top-buttonTop,behavior:'instant'});
      restorePosition();
      // Keyboard focus and browser layout anchoring can settle after the click.
      requestAnimationFrame(()=>{
        restorePosition();
        requestAnimationFrame(()=>{restorePosition();root.style.overflowAnchor=anchorStyle;});
      });
    }
  });
  new MutationObserver(paint).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
  // New ledger entries or a refreshed total also update the summary beside the hero.
  [['ledgerCount','heroDonationCount'],['ledgerCharities','heroDonationCharities']].forEach(([from,to])=>{
    const source=document.getElementById(from),target=document.getElementById(to);
    if(source&&target){const sync=()=>{target.textContent=source.textContent;};sync();new MutationObserver(sync).observe(source,{childList:true,subtree:true,characterData:true});}
  });
  const more=document.querySelector('.nav-more');
  document.addEventListener('click',e=>{if(more&&!more.contains(e.target))more.open=false;});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&more&&more.open){more.open=false;more.querySelector('summary').focus();}});
  paint();
})();
