import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../api/write-in-quote.js', import.meta.url), 'utf8');
const api = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
assert.equal(api.unitsForPrice('1'), '5000000000000000000');
assert.equal(api.unitsForPrice('0.00002'), '250000000000000000000000');
assert.equal(api.unitsForPrice('2e-5'), '250000000000000000000000');
assert.equal(api.unitsForPrice('3'), '1666666666666666667', 'round up to cover the fee');
assert.throws(()=>api.unitsForPrice('0'));
assert.throws(()=>api.unitsForPrice('NaN'));

const at = 1792432800;
let laterPrice = 100;
const history = async url => {
  assert.equal(url.searchParams.get('before_timestamp'), String(at));
  return { ok:true, json:async()=>({
    meta:{base:{address:'0xDa2598c976E62E7E15DcCa75169B404712E48B04'}},
    data:{attributes:{ohlcv_list:[
      [at + 60, laterPrice, laterPrice, laterPrice, laterPrice, 100],
      [at, laterPrice, laterPrice, laterPrice, laterPrice, 100],
      [at - 60, 0.00002, 0.00002, 0.00002, 0.00002, 100],
      [at - 120, 0.00001, 0.00001, 0.00001, 0.00001, 100],
    ]}},
  }) };
};
const original = await api.quoteAt(at, history);
assert.equal(original.units, '250000000000000000000000');
assert.equal(original.candleAt, at - 60);
laterPrice = 0.00000000001;
assert.deepEqual(await api.quoteAt(at, history), original, 'later price collapse must not change an earlier quote');
laterPrice = 1000000;
assert.deepEqual(await api.quoteAt(at, history), original, 'later price increase must not change an earlier quote');
await assert.rejects(api.quoteAt(at, async()=>({ok:false})), /unavailable/);
console.log('PASS: exact fixed fee, completed candles only, and unchanged eligibility after large later price increases or decreases.');
