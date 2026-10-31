// Read-only verification. --activate writes local config; never signs or sends.
const fs=require('fs'),path=require('path');
const {JsonRpcProvider,Contract,keccak256,AbiCoder,getCreate2Address}=require('../launch/node_modules/ethers');
const build=JSON.parse(fs.readFileSync(path.join(__dirname,'../../assets/launch-v5-contract.json')));
const M=require('./economics-model.cjs');
function recent(block){const now=Math.floor(Date.now()/1000);if(!block||!/^0x[0-9a-fA-F]{64}$/.test(block.hash||'')||!Number.isSafeInteger(block.number)||block.number<0||!Number.isSafeInteger(block.timestamp)||block.timestamp<=0||block.timestamp>now+30||now-block.timestamp>300)throw Error('A recent chain snapshot is required.');}
async function verifyDeployment(rpc,transaction){
 if(!/^0x[0-9a-fA-F]{64}$/.test(transaction||''))throw Error('A deployment transaction hash is required.');
 if((await rpc.getNetwork()).chainId!==4663n)throw Error('Wrong network');
 const [receipt,tx,snapshot]=await Promise.all([rpc.getTransactionReceipt(transaction),rpc.getTransaction(transaction),rpc.getBlock('latest')]);
 if(!receipt||receipt.status!==1||!receipt.contractAddress||!tx||tx.to!==null||tx.value!==0n)throw Error('A confirmed zero-value factory deployment is required.');
 recent(snapshot);const creationBlock=await rpc.getBlock(receipt.blockNumber);
 if(!creationBlock||creationBlock.hash!==receipt.blockHash||receipt.blockNumber>snapshot.number||tx.blockHash!==receipt.blockHash||tx.blockNumber!==receipt.blockNumber||receipt.hash!==transaction||tx.hash!==transaction)throw Error('Deployment receipt is not on the current chain.');
 if(!tx.data.startsWith(build.factory.bytecode))throw Error('Deployment creation code differs from the reviewed build.');
 const args='0x'+tx.data.slice(build.factory.bytecode.length);if(args.length!==66)throw Error('Unexpected constructor arguments');
 const [salt]=AbiCoder.defaultAbiCoder().decode(['bytes32'],args),at={blockTag:snapshot.number},factory=receipt.contractAddress;
 const c=new Contract(factory,build.factory.abi,rpc),code=await rpc.getCode(factory,snapshot.number);
 if(keccak256(code)!==build.factory.runtimeHash)throw Error('Factory runtime mismatch.');
 const [hook,router,q,terms]=await Promise.all([c.hook(at),c.router(at),c.openingQuote(at),c.previewTerms(at)]);
 if(hook.toLowerCase()!==getCreate2Address(factory,salt,build.hook.creationHash).toLowerCase()||(BigInt(hook)&0x3fffn)!==0x20ccn)throw Error('Incorrect hook wiring or permissions');
 for(const [address,a] of [[hook,build.hook],[router,build.router]]){if(keccak256(await rpc.getCode(address,snapshot.number))!==a.runtimeHash)throw Error('Hook/router code mismatch');if((await new Contract(address,['function factory() view returns(address)'],rpc).factory(at)).toLowerCase()!==factory.toLowerCase())throw Error('Incorrect factory binding');}
 if(terms.referenceUsd!==q.referenceUsd||q.ethUpdatedAt<=0n||q.ethUpdatedAt>BigInt(snapshot.timestamp)||BigInt(snapshot.timestamp)-q.ethUpdatedAt>86400n)throw Error('Inconsistent or stale opening reference.');
 const expected=M.terms(q.referenceUsd);for(const name of ['phantom','inventory','reserved','referenceQuote'])if(terms[name]!==expected[name])throw Error('Opening terms differ from reviewed economics.');
 if((await rpc.getBlock(snapshot.number))?.hash!==snapshot.hash)throw Error('Chain snapshot reorganized during verification; retry.');recent(snapshot);
 return {version:5,factory,hook,router,block:receipt.blockNumber,deploymentBlockHash:receipt.blockHash,transaction,runtimeHash:keccak256(code),verifiedAtBlock:snapshot.number,verifiedAtBlockHash:snapshot.hash,openingReferenceUsd:q.referenceUsd.toString(),ethPriceUpdatedAt:Number(q.ethUpdatedAt),graduationRule:'sellable-allocation-exhausted',checkedAt:new Date().toISOString()};
}
module.exports={verifyDeployment};
if(require.main===module)(async()=>{const rpc=new JsonRpcProvider('https://rpc.mainnet.chain.robinhood.com',4663,{staticNetwork:true});try{
 const result=await verifyDeployment(rpc,process.argv[2]);
 if(process.argv.includes('--activate')){
  for(const address of ['0xdBfabE02ab31A4Ed0c8A77c375EaF597ce7619a8','0xDD48b107aEA9666F19078aB4103E2384c31CF983'])if(await new Contract(address,['function launchCount() view returns(uint256)'],rpc).launchCount()!==0n)throw Error('Legacy launches exist: integrate their trading and claims before activation.');
  const config={LAUNCH_V5_FACTORY:result.factory,LAUNCH_V5_RUNTIME_HASH:result.runtimeHash,LAUNCH_V5_BLOCK:result.block};fs.writeFileSync(path.join(__dirname,'../../scripts/lp/launch-v5-config.js'),Object.entries(config).map(([k,v])=>'export const '+k+'='+JSON.stringify(v)+';').join('\n')+'\n');fs.writeFileSync(path.join(__dirname,'deployment.json'),JSON.stringify(result,null,2)+'\n');
 }console.log(JSON.stringify(result,null,2));
 }finally{rpc.destroy();}})().catch(e=>{console.error(e.message);process.exitCode=1});
