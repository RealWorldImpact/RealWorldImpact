const assert=require('assert/strict'),fs=require('fs'),path=require('path');
const {Interface,AbiCoder,keccak256,getCreate2Address,toBeHex}=require('ethers');
const {expectedRuntime,verifyDeployment}=require('../../contracts/launch-v4/verify-deployment.cjs');
const build=JSON.parse(fs.readFileSync(path.join(__dirname,'../../assets/launch-v4-contract.json')));
(async()=>{
 const factory='0x'+'1'.repeat(40),oracle='0x'+'2'.repeat(40),router='0x'+'3'.repeat(40),hash='0x'+'4'.repeat(64),oc='0x6000',salt=toBeHex(1,32),hook=getCreate2Address(factory,salt,build.hook.creationHash),iface=new Interface(build.factory.abi),child=new Interface(['function factory() view returns(address)']);
 const runtime=expectedRuntime(build.factory,oracle);assert.notEqual(keccak256(runtime),build.factory.runtimeHash);assert.equal(expectedRuntime(build.factory,oracle.toUpperCase().replace('0X','0x')),runtime);
 const approval={status:'verified-independent-provider',address:oracle,runtimeHash:keccak256(oc),provider:'Test only',documentation:'https://example.com/test'};
 const creationHash='0x'+'5'.repeat(64),snapshotHash='0x'+'6'.repeat(64),otherHash='0x'+'7'.repeat(64),rwi='0xda2598c976e62e7e15dcca75169b404712e48b04',assetInterface=new Interface(['function asset() view returns(address)']);
 let code=runtime,creation=build.factory.bytecode+AbiCoder.defaultAbiCoder().encode(['bytes32','address'],[salt,oracle]).slice(2),oracleCode=oc,childFactory=factory,receiptStatus=1,chain=4663n;
 let age=0,reorganized=false,canonicalCreation=creationHash,transactionBlockHash=creationHash,transactionHash=hash,asset=rwi,inconsistentQuote=false;
 let codeReads=0,contractReads=0;
 const rpc={getNetwork:async()=>({chainId:chain}),
 getBlock:async tag=>tag===100?{number:100,hash:canonicalCreation}:{number:200,hash:tag===200&&reorganized?otherHash:snapshotHash,timestamp:Math.floor(Date.now()/1000)-age},
 getTransactionReceipt:async()=>({hash,status:receiptStatus,contractAddress:factory,blockNumber:100,blockHash:creationHash}),
 getTransaction:async()=>({hash:transactionHash,blockHash:transactionBlockHash,blockNumber:100,to:null,value:0n,data:creation}),
 getCode:async(address,blockTag)=>{assert.equal(blockTag,200,'Every code read must use the same snapshot');codeReads++;return address.toLowerCase()===factory?code:address.toLowerCase()===oracle?oracleCode:address.toLowerCase()===hook.toLowerCase()?build.hook.deployedBytecode:build.router.deployedBytecode;},
 call:async tx=>{
  assert.equal(tx.blockTag,200,'Every contract read must use the same snapshot');contractReads++;
  if(tx.to.toLowerCase()===oracle)return assetInterface.encodeFunctionResult('asset',[asset]);
  if(tx.to.toLowerCase()!==factory)return child.encodeFunctionResult('factory',[childFactory]);
  const p=iface.parseTransaction(tx);return iface.encodeFunctionResult(p.name,{hook:[hook],router:[router],oracle:[oracle],readOracle:[[10n**18n,10n**18n,10n**18n,Math.floor(Date.now()/1000),1800]],previewTerms:[1,2,10n**18n+(inconsistentQuote?1n:0n)]}[p.name]);
 }};
 const verified=await verifyDeployment(rpc,hash,approval);
 assert.equal(verified.runtimeHash,keccak256(runtime));assert.equal(verified.verifiedAtBlockHash,snapshotHash);assert.equal(verified.deploymentBlockHash,creationHash);assert.equal(codeReads,4);assert.equal(contractReads,8);
 await assert.rejects(verifyDeployment(rpc,hash,{...approval,status:'awaiting-independent-provider'}),/provider first/);
 chain=1n;await assert.rejects(verifyDeployment(rpc,hash,approval),/Wrong network/);chain=4663n;
 receiptStatus=0;await assert.rejects(verifyDeployment(rpc,hash,approval),/confirmed/);receiptStatus=1;
 creation='0x6000';await assert.rejects(verifyDeployment(rpc,hash,approval),/creation code/);creation=build.factory.bytecode+AbiCoder.defaultAbiCoder().encode(['bytes32','address'],[salt,oracle]).slice(2);
 code=build.factory.deployedBytecode;await assert.rejects(verifyDeployment(rpc,hash,approval),/runtime mismatch/);code=runtime;
 oracleCode='0x6001';await assert.rejects(verifyDeployment(rpc,hash,approval),/Oracle implementation/);oracleCode=oc;
 childFactory=oracle;await assert.rejects(verifyDeployment(rpc,hash,approval),/factory binding/);childFactory=factory;
 age=301;await assert.rejects(verifyDeployment(rpc,hash,approval),/recent chain snapshot/);age=-60;await assert.rejects(verifyDeployment(rpc,hash,approval),/recent chain snapshot/);age=0;
 canonicalCreation=otherHash;await assert.rejects(verifyDeployment(rpc,hash,approval),/current chain/);canonicalCreation=creationHash;
 transactionBlockHash=otherHash;await assert.rejects(verifyDeployment(rpc,hash,approval),/current chain/);transactionBlockHash=creationHash;
 transactionHash=otherHash;await assert.rejects(verifyDeployment(rpc,hash,approval),/current chain/);transactionHash=hash;
 asset=oracle;await assert.rejects(verifyDeployment(rpc,hash,approval),/asset is not RWI/);asset=rwi;
 inconsistentQuote=true;await assert.rejects(verifyDeployment(rpc,hash,approval),/Inconsistent oracle reads/);inconsistentQuote=false;
 reorganized=true;await assert.rejects(verifyDeployment(rpc,hash,approval),/reorganized/);reorganized=false;
 console.log('PASS: oracle-bound runtime, independent-provider gate, pinned recent snapshot, canonical deployment, reorganization/stale-RPC rejection, RWI asset, bytecode and child wiring. No signing or transactions.');
})().catch(e=>{console.error(e);process.exitCode=1});
