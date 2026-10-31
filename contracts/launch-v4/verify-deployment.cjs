// Read-only chain verification. --activate writes local configuration; never signs or sends.
const fs=require('fs'),path=require('path');
const {JsonRpcProvider,Contract,keccak256,AbiCoder,getCreate2Address}=require('../launch/node_modules/ethers');
const build=JSON.parse(fs.readFileSync(path.join(__dirname,'../../assets/launch-v4-contract.json')));
const RWI='0xda2598c976e62e7e15dcca75169b404712e48b04';
function requireRecentBlock(block){
 const now=Math.floor(Date.now()/1000);
 if(!block||!/^0x[0-9a-fA-F]{64}$/.test(block.hash||'')||!Number.isSafeInteger(block.number)||block.number<0||!Number.isSafeInteger(block.timestamp)||block.timestamp<=0||block.timestamp>now+30||now-block.timestamp>300)throw Error('A recent chain snapshot is required; check the RPC and local clock.');
}
function expectedRuntime(artifact,oracle){
 let code=artifact.deployedBytecode.slice(2);const refs=Object.values(artifact.immutableReferences||{});if(refs.length!==1)throw Error('Unexpected factory immutable layout');
 const value=oracle.slice(2).toLowerCase().padStart(64,'0');for(const ref of refs[0]){if(ref.length!==32)throw Error('Unsupported immutable');code=code.slice(0,ref.start*2)+value+code.slice((ref.start+ref.length)*2);}return '0x'+code;
}
async function verifyDeployment(rpc,transaction,approval){
 if(approval.status!=='verified-independent-provider'||!/^0x[0-9a-fA-F]{40}$/.test(approval.address||'')||!/^0x[0-9a-fA-F]{64}$/.test(approval.runtimeHash||'')||!approval.provider||!approval.documentation)throw Error('Configure and review the independent RWI/USD provider first.');
 if((await rpc.getNetwork()).chainId!==4663n)throw Error('Wrong network');
 const [receipt,tx,snapshot]=await Promise.all([rpc.getTransactionReceipt(transaction),rpc.getTransaction(transaction),rpc.getBlock('latest')]);
 if(!receipt||receipt.status!==1||!receipt.contractAddress||!tx||tx.to!==null||tx.value!==0n)throw Error('A confirmed zero-value factory deployment is required.');
 requireRecentBlock(snapshot);
 const creationBlock=await rpc.getBlock(receipt.blockNumber);
 if(!creationBlock||creationBlock.hash!==receipt.blockHash||receipt.blockNumber>snapshot.number||tx.blockHash!==receipt.blockHash||tx.blockNumber!==receipt.blockNumber||receipt.hash!==transaction||tx.hash!==transaction)throw Error('Deployment receipt is not on the current chain.');
 const at={blockTag:snapshot.number};
 if(!tx.data.startsWith(build.factory.bytecode))throw Error('Deployment creation code differs from the reviewed build.');
 const args='0x'+tx.data.slice(build.factory.bytecode.length);if(args.length!==130)throw Error('Unexpected constructor arguments');
 const [salt,oracle]=AbiCoder.defaultAbiCoder().decode(['bytes32','address'],args);if(oracle.toLowerCase()!==approval.address.toLowerCase())throw Error('Oracle differs from the reviewed provider.');
 if(keccak256(await rpc.getCode(oracle,snapshot.number))!==approval.runtimeHash)throw Error('Oracle implementation changed.');
 if((await new Contract(oracle,['function asset() view returns(address)'],rpc).asset(at)).toLowerCase()!==RWI)throw Error('Oracle asset is not RWI.');
 const factory=receipt.contractAddress,c=new Contract(factory,build.factory.abi,rpc),code=await rpc.getCode(factory,snapshot.number);
 if(code.toLowerCase()!==expectedRuntime(build.factory,oracle).toLowerCase())throw Error('Factory runtime mismatch.');
 const [hook,router,actualOracle,q,terms]=await Promise.all([c.hook(at),c.router(at),c.oracle(at),c.readOracle(at),c.previewTerms(at)]);
 if(actualOracle.toLowerCase()!==oracle.toLowerCase()||hook.toLowerCase()!==getCreate2Address(factory,salt,build.hook.creationHash).toLowerCase())throw Error('Incorrect deployment wiring');
 for(const [address,a] of [[hook,build.hook],[router,build.router]]){if(keccak256(await rpc.getCode(address,snapshot.number))!==a.runtimeHash)throw Error('Hook/router code mismatch');if((await new Contract(address,['function factory() view returns(address)'],rpc).factory(at)).toLowerCase()!==factory.toLowerCase())throw Error('Incorrect factory binding');}
 if(terms.referenceUsd!==q.price)throw Error('Inconsistent oracle reads within the same block.');
 if((await rpc.getBlock(snapshot.number))?.hash!==snapshot.hash)throw Error('Chain snapshot reorganized during verification; retry.');
 requireRecentBlock(snapshot);
 return {version:4,factory,hook,router,oracle,block:receipt.blockNumber,deploymentBlockHash:receipt.blockHash,transaction,runtimeHash:keccak256(code),oracleRuntimeHash:approval.runtimeHash,provider:approval.provider,verifiedAtBlock:snapshot.number,verifiedAtBlockHash:snapshot.hash,oracleObservedAt:Number(q.observedAt),checkedAt:new Date().toISOString()};
}
module.exports={expectedRuntime,verifyDeployment};
if(require.main===module)(async()=>{
 const transaction=process.argv[2];if(!/^0x[0-9a-fA-F]{64}$/.test(transaction||''))throw Error('Usage: node verify-deployment.cjs <deployment transaction hash> [--activate]');
 const rpc=new JsonRpcProvider('https://rpc.mainnet.chain.robinhood.com',4663,{staticNetwork:true});try{
 const approval=JSON.parse(fs.readFileSync(path.join(__dirname,'oracle-release.json'))),result=await verifyDeployment(rpc,transaction,approval);
 if(process.argv.includes('--activate')){
  // Existing launch holders must never disappear during a version migration.
  for(const address of ['0xdBfabE02ab31A4Ed0c8A77c375EaF597ce7619a8','0xDD48b107aEA9666F19078aB4103E2384c31CF983'])if(await new Contract(address,['function launchCount() view returns(uint256)'],rpc).launchCount()!==0n)throw Error('Legacy launches exist: integrate their trading and claims before activation.');
  const config={LAUNCH_V4_FACTORY:result.factory,LAUNCH_V4_RUNTIME_HASH:result.runtimeHash,LAUNCH_V4_ORACLE:result.oracle,LAUNCH_V4_BLOCK:result.block};
  fs.writeFileSync(path.join(__dirname,'../../scripts/lp/launch-v4-config.js'),Object.entries(config).map(([k,v])=>'export const '+k+'='+JSON.stringify(v)+';').join('\n')+'\n');fs.writeFileSync(path.join(__dirname,'deployment.json'),JSON.stringify(result,null,2)+'\n');
 }
 console.log(JSON.stringify(result,null,2));
 }finally{rpc.destroy();}
})().catch(e=>{console.error(e.message);process.exitCode=1});
