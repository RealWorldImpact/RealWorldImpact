const { JSDOM } = require('jsdom');
const fs = require('fs');
async function test(file){
  const html = fs.readFileSync(file,'utf8');
  const dom = new JSDOM(html, { url:'https://rwihood.org/', runScripts:'dangerously', pretendToBeVisual:true });
  await new Promise(r=>setTimeout(r,150));
  const doc = dom.window.document;
  // Header must be free of any lang selector element
  const header = doc.querySelector('header');
  const inHeader = header && (header.querySelector('#langSel') || header.querySelector('[class*="lang-sel"]'));
  if(inHeader) throw new Error(`${file}: header still contains a lang selector`);
  // Floating trigger must exist
  const btn = doc.getElementById('langBtn');
  if(!btn) throw new Error(`${file}: floating trigger #langBtn missing`);
  // Panel aliased as #langSel so the runtime finds it
  const panel = doc.getElementById('langSel');
  if(!panel) throw new Error(`${file}: panel not aliased as #langSel`);
  const btns = panel.querySelectorAll('button');
  if(btns.length !== 11) throw new Error(`${file}: expected 11 buttons in panel, got ${btns.length}`);
  console.log(`${file}: header clean, floating trigger present, 11 buttons in panel`);
  // Open/close mechanics
  btn.click();
  await new Promise(r=>setTimeout(r,10));
  if(!panel.classList.contains('open')) throw new Error(`${file}: panel did not open on trigger click`);
  console.log(`  panel opens on trigger click`);
  // Language switch through the panel
  const trg = { en:'EN', es:'ES', zh:'中', ja:'日', ko:'한', pt:'PT', fr:'FR', ru:'RU', tr:'TR', vi:'VI', hi:'हि' };
  const seq = ['es','zh','hi','ja','en'];
  for(const lang of seq){
    if(!panel.classList.contains('open')) btn.click();
    await new Promise(r=>setTimeout(r,5));
    const lb = panel.querySelector(`button[data-lang="${lang}"]`);
    lb.click();
    await new Promise(r=>setTimeout(r,10));
    // Trigger label should have updated to short form
    const label = doc.getElementById('langBtnLabel').textContent;
    if(label !== trg[lang]) throw new Error(`${file}[${lang}]: trigger label expected "${trg[lang]}", got "${label}"`);
    // Panel should close after choosing
    if(panel.classList.contains('open')) throw new Error(`${file}[${lang}]: panel didn't close after selection`);
  }
  console.log(`  language cycle es→zh→hi→ja→en: trigger label updated correctly each time, panel closed each time`);
  // localStorage should reflect the last choice
  if(dom.window.localStorage.getItem('rwi_lang') !== 'en') throw new Error(`${file}: localStorage not "en" after last click`);
  console.log(`  localStorage persistence OK`);
  // Escape key closes
  btn.click();
  await new Promise(r=>setTimeout(r,5));
  const esc = new dom.window.KeyboardEvent('keydown', {key:'Escape'});
  doc.dispatchEvent(esc);
  await new Promise(r=>setTimeout(r,5));
  if(panel.classList.contains('open')) throw new Error(`${file}: Escape did not close panel`);
  console.log(`  Escape key closes panel`);
  dom.window.close();
}
(async()=>{
  for(const f of ['index.html','whitepaper.html','dashboard.html']){
    try{ await test(f); } catch(e){ console.error('FAIL', f, e.message); process.exit(1); }
  }
  console.log('all three pages · floating widget verified: open, close, switch, persist, ESC');
})();
