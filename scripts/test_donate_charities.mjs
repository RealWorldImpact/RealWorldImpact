import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../api/donate-charities.js', import.meta.url), 'utf8');
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const api = await import(moduleUrl);
const claimed = { id:'abc-123', slug:'claimed-charity', name:'Claimed Charity', status:'ACTIVE_ONBOARDED', isEnabled:true };
assert.equal(api.normalizeCharity({ ...claimed, status:'ACTIVE_NOT_ONBOARDED' }), null);
assert.equal(api.normalizeCharity({ ...claimed, status:'ACTIVE_REVIEWING_TERMS' }), null);
assert.equal(api.normalizeCharity({ ...claimed, isEnabled:false }), null);
assert.equal(api.normalizeCharity({ ...claimed, slug:'../unsafe' }), null);
assert.equal(api.normalizeCharity(claimed).id, claimed.id);

const originalFetch = globalThis.fetch;
let requests = 0;
globalThis.fetch = async url => {
  requests++;
  assert.equal(url.searchParams.get('directDonationOnly'), 'true');
  assert.equal(url.searchParams.get('publicOnly'), 'true');
  return { ok:true, json:async () => requests === 1
    ? { response:[claimed, { ...claimed, id:'unclaimed', status:'ACTIVE_NOT_ONBOARDED' }], pageKey:'next' }
    : { response:[{ ...claimed, id:'second', slug:'second' }], pageKey:null } };
};
function response() {
  return { code:0, body:null, setHeader(){}, status(code){ this.code=code; return this; }, json(body){ this.body=body; return this; } };
}
const res = response();
await api.default({ method:'GET' }, res);
assert.equal(requests, 2);
assert.equal(res.code, 200);
assert.deepEqual(res.body.charities.map(r => r.id), ['abc-123', 'second']);
await api.default({ method:'GET' }, response());
assert.equal(requests, 2, 'fresh cache avoids another upstream request');
const failingApi = await import(moduleUrl + '#failure');
globalThis.fetch = async () => { throw new Error('offline'); };
const failed = response();
await failingApi.default({ method:'GET' }, failed);
assert.equal(failed.code, 502, 'failed refresh must not claim verification');
globalThis.fetch = originalFetch;

const html = readFileSync(new URL('../vote.html', import.meta.url), 'utf8');
for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new vm.Script(match[1]);
const registryCode = html.slice(html.indexOf('const DONATE_GG_SEED ='), html.indexOf('/* Verified against the directory', html.indexOf('const DONATE_GG_SEED =')) > 0
  ? html.indexOf('/* Verified against the directory', html.indexOf('const DONATE_GG_SEED =')) : html.indexOf('let rwiUsdPrice ='));
const context = {
  ORG_POOL:{ incumbent:{name:'Incumbent Charity'}, givingblock:{name:'Giving Block Charity'} },
  TGB_DIRECTORY:[['givingblock','Giving Block Charity']], TGB_BY_SLUG:{givingblock:'Giving Block Charity'},
  TGB_BASE:'https://thegivingblock.com/donate/', SLATE:['incumbent'],
  document:{getElementById:()=>null,dispatchEvent(){}}, Event:class {}, Date, console,
};
vm.createContext(context);
vm.runInContext(registryCode, context);
context.fixture = claimed;
vm.runInContext('installDonateGg([fixture], true)', context);
assert.equal(vm.runInContext("canNominate('gg-abc-123')", context), true);
assert.equal(vm.runInContext("charityUrl('gg-abc-123')", context), 'https://www.donate.gg/charities/claimed-charity');
assert.equal(vm.runInContext("withDonateGg(['incumbent','givingblock'], 1)[1]", context), 'gg-abc-123');
assert.equal(vm.runInContext("directoryRows().some(r=>r[0]==='gg-abc-123')", context), true);
vm.runInContext('installDonateGg([], true)', context);
assert.equal(vm.runInContext("canNominate('gg-abc-123')", context), false);
assert.equal(vm.runInContext("withDonateGg(['incumbent','givingblock'], 1)[1]", context), 'givingblock');
assert.equal(context.ORG_POOL['gg-abc-123'].name, claimed.name, 'old ballot IDs remain readable');
context.fixture2 = { ...claimed, id:'second', slug:'second', name:'Second Charity' };
vm.runInContext('installDonateGg([fixture, fixture2], true)', context);
assert.notEqual(
  vm.runInContext("withDonateGg(['incumbent','givingblock'], 1)[1]", context),
  vm.runInContext("withDonateGg(['incumbent','givingblock'], 2)[1]", context),
  'Donate.gg automatic slot rotates across rounds'
);
Object.assign(context, {
  WRITEIN_TAG:'RWIWRITEIN:', RWI:'0xtoken', WRITEIN_BURN:'0xdead', WRITEIN_BURN_USD:5,
  WRITEIN_TOLERANCE:0.8, WRITEIN_SLOTS:3, rwiUsdPrice:1,
  fromHexUtf8:value=>value, usdToRwiUnits:usd=>BigInt(Math.round(usd * 100)),
});
let burns = [];
context.fetchTokenTransfersTo = async addr => { assert.equal(addr, '0xdead'); return burns; };
vm.runInContext('refreshDonateGg = async () => true', context);
vm.runInContext(html.slice(html.indexOf('function sumRwiBySender('), html.indexOf('/* ------------------------------------------------------------------- tally */')), context);
context.nomination = [{ from:'0xvoter', input:'RWIWRITEIN:1:gg-abc-123', block_number:10 }];
burns = [{ token:{address:'0xtoken'}, from:'0xvoter', block_number:11, total:{value:'500'} }];
assert.equal((await vm.runInContext('loadWriteIns(nomination, 1)', context))[0], 'gg-abc-123');
burns[0].total.value = '300';
assert.equal((await vm.runInContext('loadWriteIns(nomination, 1)', context)).length, 0);
burns[0].total.value = '500';
context.nomination.push({from:'0xvoter',input:'RWIWRITEIN:1:gg-second',block_number:12});
const paidChoices = await vm.runInContext('loadWriteIns(nomination, 1)', context);
assert.equal(paidChoices.includes('gg-second'), false, 'an earlier burn cannot fund a later nomination');
assert.equal(paidChoices.includes('gg-abc-123'), true);
context.nomination.pop();
burns[0].block_number = 10; burns[0].transaction_index = 1;
assert.equal((await vm.runInContext('loadWriteIns(nomination, 1)', context))[0], 'gg-abc-123');
burns[0].transaction_index = 0;
assert.equal((await vm.runInContext('loadWriteIns(nomination, 1)', context)).length, 0, 'same-block burn must follow nomination');
burns[0].block_number = 11;
vm.runInContext('installDonateGg([], true)', context);
burns[0].total.value = '500';
assert.equal((await vm.runInContext('loadWriteIns(nomination, 1)', context)).length, 0, 'unclaimed or removed profiles cannot enter as write-ins');
Object.assign(context, {
  OWNER_LC:'0xowner', ROUND_TAG:'RWIROUND:', AUTO_SLOTS:3, TOTAL_SLOTS:6,
  readPendingRound:()=>null, renderBallot(){}, $:()=>({textContent:''}),
  autoSlate:()=>['incumbent','givingblock','acute'],
  existingRound:[{ from:'0xowner', input:'RWIROUND:7:incumbent,givingblock,acute', block_number:20 }],
});
context.ORG_POOL.acute = {name:'Crisis Charity'};
vm.runInContext(html.slice(html.indexOf('async function loadRound('), html.indexOf('/* ---- founder panel ---- */')), context);
await vm.runInContext('loadRound(existingRound)', context);
assert.equal(context.ROUND, 7);
assert.equal(context.SLATE.join(','), 'incumbent,givingblock,acute', 'declared ballots remain unchanged');
assert(!/WRITEIN_DEV|\{dev\}|wiStep3/.test(html));
assert(html.includes('sendRwi(WRITEIN_BURN, usdToRwiUnits(WRITEIN_USD, price), payer, signer)'));
console.log('PASS: claimed-only filtering, pagination, cache, failure handling, mixed-source nominations, automatic selection, historical IDs, and full-burn fee.');
