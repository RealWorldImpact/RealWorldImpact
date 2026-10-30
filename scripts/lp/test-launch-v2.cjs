const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict'),esbuild=require('esbuild'),{Interface,AbiCoder}=require('ethers');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'rwi-curve-registry-'));
function bundle(active){let contents=fs.readFileSync(path.join(__dirname,'server/launch-registry-v2.js'),'utf8').replace(/import \{ LAUNCH_V2_FACTORY as LAUNCH_FACTORY \} from '[^']+';/,active?"const LAUNCH_FACTORY='0x1111111111111111111111111111111111111111';":"const LAUNCH_FACTORY=null;");const file=path.join(folder,active?'active.cjs':'inactive.cjs');esbuild.buildSync({stdin:{contents,resolveDir:path.join(__dirname,'server')},outfile:file,bundle:true,platform:'node',format:'cjs'});return require(file).default;}
const res=()=>({headers:{},setHeader(k,v){this.headers[k]=v},status(n){this.code=n;return this},json(v){this.body=v;return this}});
(async()=>{
 const inactive=bundle(false),active=bundle(true);let r=res();await inactive({method:'GET',query:{}},r);assert.equal(r.body.active,false);assert.equal(r.body.version,2);
 for(const before of ['x','-1',[],{},'1e3']){r=res();await active({method:'GET',query:{before}},r);assert.equal(r.code,400);}
 r=res();await active({method:'POST',query:{}},r);assert.equal(r.code,405);
 const abi=JSON.parse(fs.readFileSync(path.join(__dirname,'../../assets/launch-v2-contract.json'))).factory.abi,iface=new Interface(abi),coder=AbiCoder.defaultAbiCoder();
 const tokenIface=new Interface(['function name() view returns(string)','function symbol() view returns(string)','function logo() view returns(string)','function description() view returns(string)']);
 const old=global.fetch;try{global.fetch=async(url,options)=>({ok:true,json:async()=>JSON.parse(options.body).map(call=>{let name;try{name=iface.parseTransaction({data:call.params[0].data}).name}catch{name=tokenIface.parseTransaction({data:call.params[0].data}).name}let result;
  if(name==='launchCount')result=iface.encodeFunctionResult(name,[13]);
  else if(name==='launchedTokens'){const i=iface.decodeFunctionData(name,call.params[0].data)[0];result=iface.encodeFunctionResult(name,['0x'+(100n+i).toString(16).padStart(40,'0')]);}
  else if(name==='launches')result=iface.encodeFunctionResult(name,['0x'+'2'.repeat(40),0,'0x'+'0'.repeat(64),10n**20n,10n**20n,10n**27n*5n/7n,10n**27n*2n/7n,300,0,1793300000]);
  else if(name==='rewardRwi')result=iface.encodeFunctionResult(name,[10n**18n]);
  else result=coder.encode(['string'],[name==='name'?'<img onerror=alert(1)>':name==='symbol'?'TEST':name==='logo'?'https://example.com/a.png':'A curve token']);
  return{id:call.id,result};})});
  r=res();await active({method:'GET',query:{}},r);assert.equal(r.code,200);assert.equal(r.body.launches.length,12);assert.equal(r.body.next,'1');assert.equal(r.body.launches[0].creatorTaxBps,300);assert.equal(r.body.launches[0].phase,0);assert.equal(r.body.launches[0].rewardRwi,'1000000000000000000');
  r=res();await active({method:'GET',query:{before:'1'}},r);assert.equal(r.body.launches.length,1);assert.equal(r.body.next,null);
  global.fetch=async()=>({ok:true,json:async()=>[{id:0,error:{message:'unavailable'}}]});r=res();await active({method:'GET',query:{before:'1'}},r);assert.equal(r.code,502);
 }finally{global.fetch=old;}
 const ui=fs.readFileSync(path.join(__dirname,'launch-client.js'),'utf8');assert.ok(ui.includes('esc(t.name)'));assert.ok(ui.includes('esc(t.description'));assert.ok(ui.includes('record.phase===1n'));assert.ok(ui.includes('claimRewards.staticCall'));assert.ok(!ui.includes("encodeFunctionData('claimFees'"));
 const html=fs.readFileSync(path.join(__dirname,'../../LP.html'),'utf8');assert.ok(html.includes('id="launchCreatorTax"'));assert.ok(!html.includes('there is no graduation stage'));
 const routeFile=path.join(folder,'route.cjs');esbuild.buildSync({entryPoints:[path.join(__dirname,'../../api/lp-launches.js')],outfile:routeFile,bundle:true,platform:'node',format:'cjs'});const route=require(routeFile).default;
 try{global.fetch=async()=>({ok:true,json:async()=>[{id:0,result:coder.encode(['uint256'],[0])}]});r=res();await route({method:'GET',query:{version:'2'}},r);assert.equal(r.body.version,2);assert.equal(r.body.total,0);r=res();await route({method:'GET',query:{version:'1'}},r);assert.equal(r.body.total,0);assert.notEqual(r.body.version,2);for(const version of ['3',[]]){r=res();await route({method:'GET',query:{version}},r);assert.equal(r.code,400);}}finally{global.fetch=old;}
 assert.ok(fs.readdirSync(path.join(__dirname,'../../api')).filter(n=>n.endsWith('.js')).length<=12,'Retain the existing deployment function limit');
 console.log('PASS: curve registry phases, fee/reward fields, pagination, invalid RPC data, versioned routing, inactive deployment, and curve/ETH-claim integration.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{for(const n of fs.readdirSync(folder))fs.unlinkSync(path.join(folder,n));fs.rmdirSync(folder)});
