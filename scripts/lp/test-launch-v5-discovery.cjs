const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict'),esbuild=require('esbuild'),{Interface}=require('ethers');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'rwi-v5-discovery-')),factory='0x'+'1'.repeat(40),creator='0x'+'2'.repeat(40),W=10n**18n;
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v},status(n){this.code=n;return this},json(body){this.body=body;return this},send(body){this.body=body;return this},end(){return this}});
(async()=>{
 const file=path.join(folder,'registry.cjs');await esbuild.build({entryPoints:[path.join(__dirname,'server/launch-registry-v5.js')],outfile:file,bundle:true,platform:'node',format:'cjs',plugins:[{name:'test-config',setup(b){b.onLoad({filter:/launch-v5-config\.js$/},()=>({contents:`export const LAUNCH_V5_FACTORY='${factory}';`,loader:'js'}));}}]});
 const {default:handler,readLaunchPage}=require(file),build=JSON.parse(fs.readFileSync(path.join(__dirname,'../../assets/launch-v5-contract.json'))),fi=new Interface(build.factory.abi),ti=new Interface(['function name() view returns(string)','function symbol() view returns(string)','function logo() view returns(string)','function description() view returns(string)','function website() view returns(string)','function twitter() view returns(string)','function telegram() view returns(string)']);
 const at=Math.floor(Date.now()/1000),token=i=>'0x'+BigInt(100+i).toString(16).padStart(40,'0');let oracleDown=false;
 const oldFetch=global.fetch;global.fetch=async(url,options)=>{const body=JSON.parse(options.body);if(!Array.isArray(body)){assert.equal(body.method,'eth_getBlockByNumber');return {ok:true,json:async()=>({result:{number:'0x64',hash:'0x'+'a'.repeat(64),timestamp:'0x'+at.toString(16)}})};}
 return {ok:true,json:async()=>body.map(r=>{assert.equal(r.params[1],'0x64');let iface=fi,p=iface.parseTransaction(r.params[0]);if(!p){iface=ti;p=iface.parseTransaction(r.params[0]);}let answer;
 if(p.name==='launchCount')answer=[13];else if(p.name==='launchedTokens')answer=[token(Number(p.args[0]))];else if(p.name==='openingQuote'){if(oracleDown)return {id:r.id,error:{message:'stale'}};answer=[W,at];}
 else if(p.name==='launches')answer=[p.args[0].toLowerCase()===token(99)?'0x'+'0'.repeat(40):creator,0,'0x'+'0'.repeat(64),7500n*W,250001n*10n**16n,10n**26n,3n*10n**26n,W,0,0,10n**26n,at-1000,300,0];
 else if(p.name==='rewardRwi')answer=[W];else answer=[{name:'<img onerror=alert(1)>',symbol:'TEST',logo:'https://mz5k7vjujuasnod9.public.blob.vercel-storage.com/launch-images/v1/'+creator+'/2026-10-30/'+'a'.repeat(64)+'.png',description:'</script><script>alert(1)</script>',website:'javascript:alert(1)',twitter:'https://x.com/example',telegram:''}[p.name]];
 return {id:r.id,result:iface.encodeFunctionResult(p.name,answer)};})};};
 let page;
 try{
  for(const query of [{before:'-1'},{before:[]},{creator:'bad'},{token:['bad']}]){const r=response();await handler({method:'GET',query},r);assert.equal(r.code,400);}
  page=await readLaunchPage();assert.equal(page.launches.length,12);assert.equal(page.next,'1');assert.equal(page.launches[0].ready,true);
  const older=await readLaunchPage({before:'1'});assert.equal(older.launches.length,1);assert.equal(older.next,null);
  const missing=await readLaunchPage({token:token(99)});assert.equal(missing.launches.length,0);
  oracleDown=true;const stale=await readLaunchPage({token:token(1)});assert.equal(stale.launches.length,1);assert.equal(stale.launches[0].fdvUsd,null);assert.equal(stale.launches[0].ready,true);assert.equal(stale.launches[0].rewardRwi,W.toString());
 }finally{global.fetch=oldFetch;}
 const out=path.join(folder,'discovery.cjs');esbuild.buildSync({entryPoints:[path.join(__dirname,'server/launch-discovery.js')],outfile:out,bundle:true,platform:'node',format:'cjs'});
 const {createDiscoveryHandler,tokenMetadata,tokenList,renderTokenPage}=require(out),t=page.launches[0],metadata=tokenMetadata(t),html=renderTokenPage(t);
 assert(!metadata.links.website);assert.equal(metadata.links.twitter,'https://x.com/example');assert.equal(metadata.graduationEstimateUsd,40000);assert.equal(metadata.graduationRule,'sellable-allocation-exhausted');assert.equal(metadata.sellableTokens,(2n*10n**26n).toString());assert.equal(metadata.minimumPoolLiquidityUsd,undefined);
 assert(html.includes('&lt;img onerror=alert(1)&gt;'));assert(!html.includes('<script>alert(1)</script>'));assert(!html.includes('href="javascript:'));assert(html.includes('rel="canonical"'));assert(html.includes('/tokens/'+t.address+'.json'));assert(html.includes('application/ld+json'));
 const list=tokenList([t]);const Ajv=require('ajv'),addFormats=require('ajv-formats'),ajv=new Ajv({allErrors:true,strict:false});addFormats(ajv);const validate=ajv.compile(require('./test-fixtures/tokenlist.schema.json'));assert(validate(list),JSON.stringify(validate.errors));assert(validate(tokenList([])),JSON.stringify(validate.errors));assert.equal(list.tokens.length,2);assert.equal(list.tokens[1].chainId,4663);assert.equal(list.tokens[1].decimals,18);assert(list.tokens[1].logoURI.endsWith('.png'));
 const serve=createDiscoveryHandler({readPage:async({token:address}={})=>({...page,next:null,launches:address===token(99)?[]:[t]})});
 for(const format of ['manifest','tokenlist','metadata','page','sitemap']){const r=response();await serve({method:'GET',query:{format,address:t.address}},r);assert.equal(r.code,200,format);assert.equal(r.headers['Access-Control-Allow-Origin'],'*');assert(r.body);}
 let r=response();await serve({method:'GET',query:{format:'metadata',address:token(99)}},r);assert.equal(r.code,404);r=response();await serve({method:'GET',query:{format:'page',address:[]}},r);assert.equal(r.code,400);r=response();await serve({method:'HEAD',query:{format:'tokenlist'}},r);assert.equal(r.code,200);assert.equal(r.body,undefined);
 const failed=createDiscoveryHandler({readPage:async()=>{throw Error('RPC down')}});r=response();await failed({method:'GET',query:{format:'tokenlist'}},r);assert.equal(r.code,503);assert(!r.body.tokens);
 const cyclic=createDiscoveryHandler({readPage:async()=>({...page,next:'1'})});r=response();await cyclic({method:'GET',query:{format:'tokenlist'}},r);assert.equal(r.code,503);
 console.log('PASS: snapshot registry, pagination, unknown tokens, stale-feed metadata/rewards, CORS feeds, escaped SSR/JSON metadata and complete-list failure behavior.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{for(const n of fs.readdirSync(folder))fs.unlinkSync(path.join(folder,n));fs.rmdirSync(folder)});
