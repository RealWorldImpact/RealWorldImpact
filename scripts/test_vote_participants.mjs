import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../vote.html', import.meta.url), 'utf8');
const code = source.slice(source.indexOf('function participatingVoters('), source.indexOf('/* The connected wallet'));
const address = n => '0x' + n.toString(16).padStart(40,'0');
const unit = 10n ** 18n;
const nodes = Object.fromEntries(['voterRows','voterTableWrap','voterEmpty','voterCount','voterNotice'].map(id=>[id,{innerHTML:'',hidden:false,textContent:''}]));
const context = vm.createContext({
  ROUND:12, SLATE:['a','b'], RWI_DECIMALS:18, account:address(2), pendingVote:null,
  SCAN:'https://robinhoodchain.blockscout.com', $:id=>nodes[id],
  fmtToken:n=>(n/unit).toString(),
  esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),
  orgRecord:slug=>({name:slug==='a'?'World Central Kitchen':'A & B <Charity>'}),
  lastTally:{ round:12, total:4n*unit, unreadable:1, truncated:false,
    latestMap:new Map([
      [address(1),{slug:'a'}], [address(2),{slug:'b'}], [address(3),{slug:'a'}],
      [address(4),{slug:'a'}], [address(5),{slug:'old-round-choice'}], ['bad-address',{slug:'a'}],
    ]),
    weights:new Map([[address(1),unit],[address(2),3n*unit],[address(3),0n]]),
  },
});
vm.runInContext(code,context);
const voters = context.participatingVoters(context.lastTally,12,context.SLATE);
assert.equal(voters.length,4,'include every valid current-round voter, including zero and unknown balances');
assert.equal(voters[0].address,address(2),'largest voting weight first');
assert.equal(voters.at(-1).weight,null,'unavailable balances remain unknown, not zero');
context.renderVoters();
assert.equal((nodes.voterRows.innerHTML.match(/<tr>/g)||[]).length,4);
assert(nodes.voterRows.innerHTML.includes('A &amp; B &lt;Charity&gt;'));
assert(nodes.voterRows.innerHTML.includes('75.0% of voting weight'));
assert(nodes.voterRows.innerHTML.includes('No current voting weight'));
assert(nodes.voterRows.innerHTML.includes('Balance unavailable'));
assert(nodes.voterRows.innerHTML.includes('>You</span>'));
assert(nodes.voterRows.innerHTML.includes('/address/'+address(2)));
assert.equal(nodes.voterTableWrap.hidden,false);
context.lastTally.latestMap.set(address(1),{slug:'b'});
assert.equal(context.participatingVoters(context.lastTally,12,context.SLATE).filter(r=>r.address===address(1)).length,1,'re-voting keeps one current row');
context.lastTally.latestMap.clear(); context.lastTally.unreadable=0;
context.renderVoters();
assert.equal(nodes.voterEmpty.hidden,false);
assert.equal(nodes.voterTableWrap.hidden,true);
context.ROUND=13; context.renderVoters();
assert.equal(nodes.voterRows.innerHTML,'','new rounds cannot display old voters');
assert.equal(nodes.voterEmpty.hidden,true,'loading is not mistaken for an empty round');
console.log('PASS: current-round voters, latest choices, weight sorting, unknown balances, wallet links, escaping, and empty/loading states.');
