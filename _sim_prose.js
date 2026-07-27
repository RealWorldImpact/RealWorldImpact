const { JSDOM } = require('jsdom');
const fs = require('fs');
async function test(file, proseKeys){
  const html = fs.readFileSync(file,'utf8');
  const dom = new JSDOM(html, { url:'https://rwihood.org/', runScripts:'dangerously', pretendToBeVisual:true });
  await new Promise(r=>setTimeout(r,150));
  const doc = dom.window.document;
  const panel = doc.getElementById('langSel');
  let failures = [];
  // For each language, switch and check that prose keys don't render as literal key names
  for(const lang of ['en','es','zh','ja','ko','pt','fr','ru','tr','vi','hi']){
    const b = panel.querySelector(`button[data-lang="${lang}"]`);
    b.click();
    await new Promise(r=>setTimeout(r,8));
    for(const key of proseKeys){
      const node = doc.querySelector(`[data-i18n="${key}"]`);
      if(!node){ failures.push(`${lang}: node [${key}] missing`); continue; }
      const txt = node.textContent.trim();
      // Fail if the rendered text is literally the key name (means translation missing)
      if(txt === key) failures.push(`${lang}: [${key}] rendered as literal key name`);
      if(txt === '') failures.push(`${lang}: [${key}] empty`);
    }
  }
  if(failures.length){
    console.error(`✗ ${file}:`);
    failures.slice(0,10).forEach(f=>console.error('   '+f));
    if(failures.length>10) console.error(`   ...and ${failures.length-10} more`);
    return false;
  }
  console.log(`✓ ${file}: all ${proseKeys.length} prose keys resolve in all 11 languages`);
  return true;
}
(async()=>{
  let ok = true;
  ok = await test('index.html', ['index.pons.how','index.team.louis.bio1','index.team.james.bio1','index.footer.disclaimer','index.premise.body','index.chain.body']) && ok;
  ok = await test('whitepaper.html', ['wp.abstract.body1','wp.premise.body1','wp.works.body3','wp.burn.body2','wp.ledger.body1','wp.token.notwhat.body','wp.change.body2','wp.founder.body1','wp.risks.body2','wp.refs.tokenContract','wp.footer.brand']) && ok;
  ok = await test('dashboard.html', ['hero.lede','zap.selectPool','unzap.footnote']) && ok;
  console.log(ok ? '\nALL PROSE VERIFIED across all pages and languages' : '\nFAILURES DETECTED');
  process.exit(ok?0:1);
})();
