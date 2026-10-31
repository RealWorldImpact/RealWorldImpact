const fs=require('fs'),path=require('path');
if(process.argv.includes('--export')&&process.argv.includes('--test'))throw Error('Export production compilation separately from test builds.');
const solc=require('../launch/node_modules/solc'),{keccak256}=require('../launch/node_modules/ethers');
const read=p=>fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
const input={language:'Solidity',sources:{'RWILaunchV4.sol':{content:read(path.join(__dirname,'RWILaunchV4.sol'))}},settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'cancun',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object','evm.deployedBytecode.immutableReferences']}}}};
const resolve=name=>name.startsWith('launch-v3/')?path.join(__dirname,'..',name):path.join(__dirname,name.startsWith('@')?'../launch/node_modules':'',name);
if(process.argv.includes('--test'))input.sources['SwapHarness.sol']={content:read(path.join(__dirname,'../launch-v3/SwapHarness.sol'))};
if(process.argv.includes('--test'))input.sources['TestSupport.sol']={content:read(path.join(__dirname,'TestSupport.sol'))};
const output=JSON.parse(solc.compile(JSON.stringify(input),{import:name=>{try{return{contents:read(resolve(name))}}catch{return{error:'Missing '+name}}}}));
for(const e of output.errors||[])console.log(e.formattedMessage);
if(output.errors?.some(e=>e.severity==='error'))process.exit(1);
fs.mkdirSync(path.join(__dirname,'artifacts'),{recursive:true});
fs.writeFileSync(path.join(__dirname,'artifacts/standard-input.json'),JSON.stringify({...input,sources:Object.fromEntries(Object.keys(output.sources).map(name=>[name,{content:input.sources[name]?.content??read(resolve(name))}]))}));
const contracts={};for(const group of Object.values(output.contracts))for(const [name,c]of Object.entries(group)){
 if(!c.evm.bytecode.object)continue;
 const a={abi:c.abi,bytecode:'0x'+c.evm.bytecode.object,deployedBytecode:'0x'+c.evm.deployedBytecode.object,immutableReferences:c.evm.deployedBytecode.immutableReferences};
 a.creationHash=keccak256(a.bytecode);a.runtimeHash=keccak256(a.deployedBytecode);
 if(a.deployedBytecode.length/2-1>24576||a.bytecode.length/2-1>49152)throw Error(name+' exceeds deployment size limits');
 fs.writeFileSync(path.join(__dirname,'artifacts',name+'.json'),JSON.stringify(a));contracts[name]=a;
 if(name.startsWith('RWI'))console.log(name,'runtime',c.evm.deployedBytecode.object.length/2,'creation',c.evm.bytecode.object.length/2);
}
// Export only production contracts. Test doubles are never copied to site assets.
if(process.argv.includes('--export')){
 const bundle={version:4,compiler:solc.version(),factory:contracts.RWILaunchV4,hook:contracts.RWICreatorHookV4,router:contracts.RWILaunchRouterV4,token:contracts.RWICurveTokenV4};
 fs.writeFileSync(path.join(__dirname,'../../assets/launch-v4-contract.json'),JSON.stringify(bundle));
 const module=Object.entries({LAUNCH_V4_ABI:bundle.factory.abi,LAUNCH_V4_ROUTER_ABI:bundle.router.abi,LAUNCH_V4_HOOK_RUNTIME_HASH:bundle.hook.runtimeHash,LAUNCH_V4_ROUTER_RUNTIME_HASH:bundle.router.runtimeHash,LAUNCH_V4_CREATION_HASH:bundle.factory.creationHash}).map(([k,v])=>'export const '+k+'='+JSON.stringify(v)+';').join('\n')+'\n';
 fs.writeFileSync(path.join(__dirname,'../../scripts/lp/launch-v4-contract.js'),module);
 fs.copyFileSync(path.join(__dirname,'artifacts/standard-input.json'),path.join(__dirname,'../../assets/launch-v4-sources.json'));
}
