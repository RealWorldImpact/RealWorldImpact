const fs=require('fs'),path=require('path'),solc=require('solc');
const input={language:'Solidity',sources:{'RWILaunchFactory.sol':{content:fs.readFileSync(path.join(__dirname,'RWILaunchFactory.sol'),'utf8')}},settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'cancun',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}}};
if(process.argv.includes('--test'))input.sources['SwapTest.sol']={content:fs.readFileSync(path.join(__dirname,'SwapTest.sol'),'utf8')};
const output=JSON.parse(solc.compile(JSON.stringify(input),{import:name=>{try{return{contents:fs.readFileSync(path.join(__dirname,'node_modules',name),'utf8')}}catch{return{error:'Missing import '+name}}}}));
for(const error of output.errors||[])console.log(error.formattedMessage);
if(output.errors?.some(e=>e.severity==='error'))process.exit(1);
fs.mkdirSync(path.join(__dirname,'artifacts'),{recursive:true});
for(const [name,c]of Object.entries({...output.contracts['RWILaunchFactory.sol'],...output.contracts['SwapTest.sol']}))fs.writeFileSync(path.join(__dirname,'artifacts',name+'.json'),JSON.stringify({abi:c.abi,bytecode:'0x'+c.evm.bytecode.object,deployedBytecode:'0x'+c.evm.deployedBytecode.object}));
const c=output.contracts['RWILaunchFactory.sol'].RWILaunchFactory;console.log('Factory runtime bytes:',c.evm.deployedBytecode.object.length/2);
if(c.evm.deployedBytecode.object.length/2>24576||c.evm.bytecode.object.length/2>49152)throw Error('Factory exceeds deployment size limits');
console.log('Factory creation bytes:',c.evm.bytecode.object.length/2);

// Reproducible public artifacts used by the interface and the deployment helper.
const {keccak256,Interface}=require('ethers');const artifact={abi:c.abi,bytecode:'0x'+c.evm.bytecode.object,deployedBytecode:'0x'+c.evm.deployedBytecode.object};
fs.writeFileSync(path.join(__dirname,'../../assets/launch-contract.json'),JSON.stringify({...artifact,runtimeHash:keccak256(artifact.deployedBytecode),compiler:'0.8.26',optimizerRuns:200,evmVersion:'cancun'}));
const iface=new Interface(c.abi),selectors=Object.fromEntries(['launchCount','launchedTokens','launches'].map(n=>[n,iface.getFunction(n).selector]));
for(const s of ['name()','symbol()','logo()','description()'])selectors[s.split('(')[0]]=new Interface(['function '+s+' view returns(string)']).getFunction(s).selector;
fs.writeFileSync(path.join(__dirname,'../../scripts/lp/launch-contract.js'),'// Generated from contracts/launch/RWILaunchFactory.sol.\nexport const LAUNCH_ABI='+JSON.stringify(c.abi)+';\nexport const LAUNCH_RUNTIME_HASH='+JSON.stringify(keccak256(artifact.deployedBytecode))+';\nexport const LAUNCH_CREATION_HASH='+JSON.stringify(keccak256(artifact.bytecode))+';\nexport const LAUNCH_ROUTER_ABI='+JSON.stringify(output.contracts['RWILaunchFactory.sol'].RWILaunchRouter.abi)+';\nexport const LAUNCH_SELECTORS='+JSON.stringify(selectors)+';\n');
