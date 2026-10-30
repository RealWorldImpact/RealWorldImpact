const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const file=path.join(require('node:os').tmpdir(),'lp-security-'+process.pid+'.cjs');
require('esbuild').buildSync({entryPoints:[path.join(__dirname,'transaction-history.js')],outfile:file,bundle:true,platform:'node',format:'cjs'});
const {cleanTransactions}=require(file);fs.unlinkSync(file);
const valid={hash:'0x'+'a'.repeat(64),account:'0x'+'b'.repeat(40),chain:4663,label:'Deposit',status:'Confirmed',time:new Date().toISOString()};
assert.equal(cleanTransactions([valid]).length,1);
for(const patch of [{hash:'" onmouseover="alert(1)'},{account:'bad'},{chain:1},{time:'bad'},{label:null},{status:{} }])assert.equal(cleanTransactions([{...valid,...patch}]).length,0);
assert.equal(cleanTransactions([null,[],{},'bad']).length,0);
assert.equal(cleanTransactions(Array(120).fill(valid)).length,100);
assert.equal(cleanTransactions([{...valid,label:'a'.repeat(500)}])[0].label.length,160);
const config=JSON.parse(fs.readFileSync(path.join(__dirname,'../../vercel.json'),'utf8'));
for(const route of ['/LP','/LP.html']){
 const headers=Object.fromEntries(config.headers.find(h=>h.source===route).headers.map(h=>[h.key,h.value]));
 assert.equal(headers['X-Frame-Options'],'DENY');assert.equal(headers['X-Content-Type-Options'],'nosniff');
 const csp=headers['Content-Security-Policy'];for(const directive of ["script-src 'self'","frame-ancestors 'none'","object-src 'none'","base-uri 'none'"])assert.ok(csp.includes(directive));assert.ok(!csp.includes('unsafe-eval'));
}
console.log('PASS: malformed stored activity, injected transaction URLs, network filtering, bounded history and LP security headers.');
