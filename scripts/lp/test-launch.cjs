const fs=require('fs'),path=require('path'),assert=require('assert/strict'),os=require('os'),esbuild=require('esbuild');
const {AbiCoder,parseUnits}=require('ethers');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'rwi-launch-test-'));
function bundle(entry,name,active=false){const file=path.join(folder,name+'.cjs'),source=path.join(__dirname,entry);let contents=fs.readFileSync(source,'utf8');if(entry.endsWith('lp-launches.js'))contents=contents.replace(/import \{ LAUNCH_FACTORY \} from '[^']+';/,active?"const LAUNCH_FACTORY='0x1111111111111111111111111111111111111111';":"const LAUNCH_FACTORY=null;");esbuild.buildSync({stdin:{contents,resolveDir:path.dirname(source),sourcefile:path.basename(source)},outfile:file,bundle:true,platform:'node',format:'cjs'});return require(file);}

const M=bundle('launch-model.js','model'),inactive=bundle('../../api/lp-launches.js','inactive').default,active=bundle('../../api/lp-launches.js','active',true).default;
const coder=AbiCoder.defaultAbiCoder();
function response(){return{headers:{},setHeader(k,v){this.headers[k]=v},status(c){this.code=c;return this},json(b){this.body=b;return this}};}
(async()=>{
 const terms=M.launchTerms('0.00002665263821');assert.equal(terms.targetMarketCapUsd,'5000');assert.ok(Math.abs(Number(terms.marketCapUsd)-5000)<.000001);assert.equal(parseUnits(terms.marketCapRwi,18),BigInt(terms.phantomQuote));
 for(const value of ['0','-1','1e3','x',null,'0.000000000000000000000000000000000001'])assert.throws(()=>M.launchTerms(value));
 const valid={name:'My token',symbol:'mt',description:'hello',logo:'ipfs://'+'a'.repeat(46),website:'https://example.com'};
 assert.equal(M.launchMetadata(valid).symbol,'MT');assert.match(M.launchMetadata(valid).logo,/^https:/);
 for(const patch of [{name:''},{name:'a'.repeat(33)},{symbol:'<img>'},{description:'a'.repeat(257)},{logo:'javascript:alert(1)'},{website:'http://example.com'},{twitter:'https://user:password@example.com'}])assert.throws(()=>M.launchMetadata({...valid,...patch}));
 let r=response();await inactive({method:'GET',query:{}},r);assert.equal(r.body.active,false);
 r=response();await active({method:'GET',query:{before:'invalid'}},r);assert.equal(r.code,400);
 r=response();await active({method:'POST',query:{}},r);assert.equal(r.code,405);
 const original=global.fetch;let count=14;const {LAUNCH_SELECTORS:S}=bundle('launch-contract.js','contract');
 global.fetch=async(url,options)=>({ok:true,json:async()=>JSON.parse(options.body).map(call=>{const data=call.params[0].data,selector=data.slice(0,10);let result;
   if(selector===S.launchCount)result=coder.encode(['uint256'],[count]);
   else if(selector===S.launchedTokens)result=coder.encode(['address'],['0x'+(BigInt('0x'+data.slice(10))+100n).toString(16).padStart(40,'0')]);
   else if(selector===S.launches)result=coder.encode(['address','uint256','bytes32','int24','bool','uint64'],['0x'+'2'.repeat(40),42,'0x'+'a'.repeat(64),-69000,true,1000000]);
   else result=coder.encode(['string'],[selector===S.name?'<svg onload=alert(1)>':selector===S.symbol?'TEST':selector===S.logo?'https://example.com/logo.png':'Community token']);
   return{id:call.id,result};})});
 r=response();await active({method:'GET',query:{}},r);assert.equal(r.code,200);assert.equal(r.body.launches.length,12);assert.equal(r.body.next,'2');assert.equal(r.body.launches[0].startTick,-69000);assert.equal(r.body.launches[0].name,'<svg onload=alert(1)>');
 r=response();await active({method:'GET',query:{before:'2'}},r);assert.equal(r.body.launches.length,2);assert.equal(r.body.next,null);
 r=response();await active({method:'GET',query:{before:'0'}},r);assert.equal(r.body.launches.length,0);
 global.fetch=original;
 console.log('PASS: RWI starting-price rounding, metadata/link limits, gas-only launch inputs, inactive registry, API method/cursor validation, signed ticks, newest-first pagination and empty pages.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>(()=>{for(const name of fs.readdirSync(folder))fs.unlinkSync(path.join(folder,name));fs.rmdirSync(folder);})());
