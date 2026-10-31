const assert=require('assert/strict'),fs=require('fs'),path=require('path');
const {Interface,AbiCoder,keccak256,getCreate2Address,toBeHex}=require('ethers');
const {expectedRuntime,verifyDeployment}=require('../../contracts/launch-v4/verify-deployment.cjs');
const build=JSON.parse(fs.readFileSync(path.join(__dirname,'../../assets/launch-v4-contract.json')));
(async()=>{
 const factory='0x'+'1'.repeat(40),oracle='0x'+'2'.repeat(40),router='0x'+'3'.repeat(40),hash='0x'+'4'.repeat(64),oc='0x6000',salt=toBeHex(1,32),hook=getCreate2Address(factory,salt,build.hook.creationHash),iface=new Interface(build.factory.abi),child=new Interface(['function factory() view returns(address)']);
 const runtime=expectedRuntime(build.factory,oracle);assert.notEqual(keccak256(runtime),build.factory.runtimeHash);assert.equal(expectedRuntime(build.factory,oracle.toUpperCase().replace('0X','0x')),runtime);
 const approval={status:'verified-independent-provider',address:oracle,runtimeHash:keccak256(oc),provider:'Test only',documentation:'https://example.com/test'};
 let code=runtime,creation=build.factory.bytecode+AbiCoder.defaultAbiCoder().encode(['bytes32','address'],[salt,oracle]).slice(2),oracleCode=oc,childFactory=factory,receiptStatus=1,chain=4663n;
 const rpc={getNetwork:async()=>({chainId:chain}),getTransactionReceipt:async()=>({status:receiptStatus,contractAddress:factory,blockNumber:100}),getTransaction:async()=>({to:null,value:0n,data:creation}),getCode:async address=>address.toLowerCase()===factory?code:address.toLowerCase()===oracle?oracleCode:address.toLowerCase()===hook.toLowerCase()?build.hook.deployedBytecode:build.router.deployedBytecode,
 call:async tx=>{if(tx.to.toLowerCase()!==factory)return child.encodeFunctionResult('factory',[childFactory]);const p=iface.parseTransaction(tx);return iface.encodeFunctionResult(p.name,{hook:[hook],router:[router],oracle:[oracle],readOracle:[[10n**18n,10n**18n,10n**18n,Math.floor(Date.now()/1000),1800]],previewTerms:[1,2,10n**18n]}[p.name]);}};
 assert.equal((await verifyDeployment(rpc,hash,approval)).runtimeHash,keccak256(runtime));
 await assert.rejects(verifyDeployment(rpc,hash,{...approval,status:'awaiting-independent-provider'}),/provider first/);
 chain=1n;await assert.rejects(verifyDeployment(rpc,hash,approval),/Wrong network/);chain=4663n;
 receiptStatus=0;await assert.rejects(verifyDeployment(rpc,hash,approval),/confirmed/);receiptStatus=1;
 creation='0x6000';await assert.rejects(verifyDeployment(rpc,hash,approval),/creation code/);creation=build.factory.bytecode+AbiCoder.defaultAbiCoder().encode(['bytes32','address'],[salt,oracle]).slice(2);
 code=build.factory.deployedBytecode;await assert.rejects(verifyDeployment(rpc,hash,approval),/runtime mismatch/);code=runtime;
 oracleCode='0x6001';await assert.rejects(verifyDeployment(rpc,hash,approval),/Oracle implementation/);oracleCode=oc;
 childFactory=oracle;await assert.rejects(verifyDeployment(rpc,hash,approval),/factory binding/);
 console.log('PASS: oracle-bound runtime, provider approval, network/receipt/creation checks, changed oracle and hook/router wiring rejection. No signing or transactions.');
})().catch(e=>{console.error(e);process.exitCode=1});
