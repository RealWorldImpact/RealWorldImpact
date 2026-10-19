import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../vote.html', import.meta.url), 'utf8');
function section(start, end) {
  const a = html.indexOf(start), b = html.indexOf(end, a);
  assert(a >= 0 && b > a, start);
  return html.slice(a, b);
}
function run(code, values) {
  const context = vm.createContext(values);
  vm.runInContext(code, context);
  return context;
}
const receipts = run(section('async function waitForTx(', '/* ------------------------------------------------------- rounds'), {
  rpc:async()=>null, setTimeout:callback=>callback(), Date, Error,
});
await assert.rejects(receipts.waitForTx('0xpending', 1), e => e.code === 'TX_PENDING' && e.hash === '0xpending');
assert.equal(receipts.txSucceeded(null), false);
assert.equal(receipts.txSucceeded({blockNumber:'0x1'}), false);
assert.equal(receipts.txSucceeded({status:'0x0'}), false);
assert.equal(receipts.txSucceeded({status:'0x1'}), true);
receipts.rpc = async()=>({blockNumber:'0x1',status:'0x1'});
assert.equal((await receipts.waitForTx('0xconfirmed', 1)).status, '0x1');

let rpcReads = 0;
const transport = run(section('let rpcI = 0;', 'async function erc20BalanceOf('), {
  wallet:null, walletOnChain:false, RPCS:['test'], Date,
  fetchWithTimeout:async()=>{ rpcReads++; return {json:async()=>({result:null})}; },
});
assert.equal(await transport.rpc('eth_getTransactionReceipt', ['0xpending']), null);
assert.equal(rpcReads, 1, 'null receipt is a pending response, not a transport failure');
const indexed = run(section('function indexedTxSucceeded(', 'async function fetchVoteTxsUncached('), {});
assert.equal(indexed.indexedTxSucceeded({block_number:1,status:'ok',result:'success'}), true);
assert.equal(indexed.indexedTxSucceeded({block_number:1,status:'error',result:'out of gas'}), false);
assert.equal(indexed.indexedTxSucceeded({status:'ok'}), false, 'unmined records cannot count');

let chain = '0x1237';
const signer = {request:async({method})=>method === 'eth_accounts' ? ['0xabc'] : chain};
const identity = run(section('async function assertWalletContext(', 'let voteBusy = false;'), {
  wallet:signer, account:'0xabc', CHAIN:{idHex:'0x1237'},
});
await identity.assertWalletContext(signer, '0xabc');
chain = '0x1';
await assert.rejects(identity.assertWalletContext(signer, '0xabc'), /network changed/);
chain = '0x1237'; identity.account = '0xother';
await assert.rejects(identity.assertWalletContext(signer, '0xabc'), /Wallet changed/);

let releases, submissions = 0;
const waiting = new Promise(resolve=>{ releases=resolve; });
const submit = run(section('  async function submit(){', '  async function submitWriteIn(){'), {
  busy:false, updateSubmitState(){}, wiStatus(){}, t:x=>x,
  submitWriteIn:async()=>{ submissions++; await waiting; },
});
const first = submit.submit();
await submit.submit();
assert.equal(submissions, 1, 'double-click cannot start two write-in flows');
releases(); await first;
assert.equal(submit.busy, false);

let releaseVote, sentVotes = 0;
const gasWait = new Promise(resolve=>{ releaseVote=resolve; });
const voteMessages = [];
const voteWallet = {request:async()=>{ sentVotes++; return '0xpending'; }};
const cast = run(section('let voteBusy = false;', 'async function waitForTx('), {
  account:'0xabc', wallet:voteWallet, walletOnChain:true, ballotResolved:true,
  selected:'charity', myPower:1n, ROUND:1, BALLOT_BOX:'0xbox', ballotBoxIsContract:false,
  clearVoteStatus(){}, votePrefix:()=> 'RWIVOTE:1:', toHexUtf8:x=>x,
  $:()=>({disabled:false}), voteStatus:message=>voteMessages.push(message), t:x=>x,
  preflightGas:async()=>{ await gasWait; return '0x10000'; }, assertWalletContext:async()=>{},
  waitForTx:async()=>{ const e=new Error('pending'); e.code='TX_PENDING'; throw e; },
  pendingVote:null, updateVoteButton(){},
});
const casting = cast.castVote();
await cast.castVote();
releaseVote(); await casting;
assert.equal(sentVotes, 1, 'double-click cannot send two votes');
assert.equal(cast.pendingVote, null, 'unconfirmed vote must not be optimistically counted');
assert(voteMessages.includes('vote.st.txPending'));
assert(!voteMessages.includes('vote.st.voteOk'));

let clock = 100000, reads = 0, balance = 100n;
const elements = new Map();
const tally = run(section('function paintFrom(', '/* The connected wallet'), {
  lastTally:null, tallySeq:0, votePagesTruncated:false, pendingVote:null,
  Date:{now:()=>clock}, SLATE:['charity'], RWI:'0xtoken',
  $:id=>{ if(!elements.has(id)) elements.set(id, {textContent:''}); return elements.get(id); },
  t:x=>x, votePrefix:()=> 'RWIVOTE:1:', fromHexUtf8:x=>x,
  erc20BalanceOf:async()=>{ reads++; return balance; }, paintTally(){}, showMyVote(){},
});
const votes = [{from:'0xabc',input:'RWIVOTE:1:charity',block_number:1}];
await tally.loadTally(votes);
assert.equal(reads, 1);
balance = 200n;
await tally.loadTally(votes);
assert.equal(reads, 1, 'short cache avoids unnecessary reads');
clock += 31000;
await tally.loadTally(votes);
assert.equal(reads, 2, 'unchanged votes must still refresh live balances');
assert.equal(tally.lastTally.total, 200n);
Object.assign(tally, {
  refreshSeq:0, fetchVoteTxs:async()=>votes, loadRound:async()=>{},
  ballotResolved:true, selected:null, voteTxCache:null,
  updateSlateNotice(){}, renderBallot(){}, renderOwnerPanel(){}, updateVoteButton(){},
});
vm.runInContext(section('async function refreshAll(opts){', '/* --------------------------------------------------------------- write-ins'), tally);
await tally.refreshAll({force:true});
assert.equal(reads, 3, 'manual refresh must bypass cached balances');
tally.refreshAllUnchecked = async()=>{ tally.refreshSeq++; throw new Error('offline'); };
assert.equal(await tally.refreshAll({force:true}), false);
assert.equal(elements.get('tallyTotals').textContent, 'vote.st.tallyErr');
console.log('PASS: pending confirmations, strict receipt status, RPC null responses, wallet/network changes, duplicate submissions, fresh balances, and refresh errors.');
