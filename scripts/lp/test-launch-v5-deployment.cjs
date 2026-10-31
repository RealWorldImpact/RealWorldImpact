const assert=require('assert/strict'),fs=require('fs'),path=require('path');
const {Interface,AbiCoder,keccak256,getCreate2Address,toBeHex}=require('ethers');
const {verifyDeployment}=require('../../contracts/launch-v5/verify-deployment.cjs'),M=require('../../contracts/launch-v5/economics-model.cjs');
const build=JSON.parse(fs.readFileSync(path.join(__dirname,'../../assets/launch-v5-contract.json')));
(async()=>{
 const factory='0x'+'1'.repeat(40),other='0x'+'2'.repeat(40),router='0x'+'3'.repeat(40),hash='0x'+'4'.repeat(64),creationHash='0x'+'5'.repeat(64),snapshotHash='0x'+'6'.repeat(64),otherHash='0x'+'7'.repeat(64),iface=new Interface(build.factory.abi),child=new Interface(['function factory() view returns(address)']);
 let salt,hook,n=0;do{salt=toBeHex(n++,32);hook=getCreate2Address(factory,salt,build.hook.creationHash)}while((BigInt(hook)&0x3fffn)!==0x20ccn);
 const data=build.factory.bytecode+AbiCoder.defaultAbiCoder().encode(['bytes32'],[salt]).slice(2);
 let code=build.factory.deployedBytecode,creation=data,childFactory=factory,receiptStatus=1,chain=4663n,childCode=false;
 let age=0,reorganized=false,canonicalCreation=creationHash,transactionBlockHash=creationHash,transactionHash=hash,stale=false,inconsistentQuote=false,badTerms=false;
 let codeReads=0,contractReads=0;const fixtureTime=Math.floor(Date.now()/1000),now=()=>fixtureTime;
 const rpc={getNetwork:async()=>({chainId:chain}),getBlock:async tag=>tag===100?{number:100,hash:canonicalCreation}:{number:200,hash:tag===200&&reorganized?otherHash:snapshotHash,timestamp:now()-age},getTransactionReceipt:async()=>({hash,status:receiptStatus,contractAddress:factory,blockNumber:100,blockHash:creationHash}),getTransaction:async()=>({hash:transactionHash,blockHash:transactionBlockHash,blockNumber:100,to:null,value:0n,data:creation}),
 getCode:async(address,blockTag)=>{assert.equal(blockTag,200);codeReads++;return address.toLowerCase()===factory?code:childCode?'0x6001':address.toLowerCase()===hook.toLowerCase()?build.hook.deployedBytecode:build.router.deployedBytecode;},
 call:async tx=>{assert.equal(tx.blockTag,200);contractReads++;if(tx.to.toLowerCase()!==factory)return child.encodeFunctionResult('factory',[childFactory]);const p=iface.parseTransaction(tx),t=M.terms(M.W);return iface.encodeFunctionResult(p.name,{hook:[hook],router:[router],openingQuote:[M.W,now()-(stale?86401:0)],previewTerms:[t.phantom,t.inventory,t.reserved+(badTerms?1n:0n),t.referenceQuote,M.W+(inconsistentQuote?1n:0n)]}[p.name]);}};
 const verified=await verifyDeployment(rpc,hash);assert.equal(verified.version,5);assert.equal(verified.runtimeHash,keccak256(code));assert.equal(verified.verifiedAtBlockHash,snapshotHash);assert.equal(verified.deploymentBlockHash,creationHash);assert.equal(codeReads,3);assert.equal(contractReads,6);
 chain=1n;await assert.rejects(verifyDeployment(rpc,hash),/Wrong network/);chain=4663n;
 receiptStatus=0;await assert.rejects(verifyDeployment(rpc,hash),/confirmed/);receiptStatus=1;
 creation='0x6000';await assert.rejects(verifyDeployment(rpc,hash),/creation code/);creation=data+'00';await assert.rejects(verifyDeployment(rpc,hash),/constructor/);creation=data;
 code='0x6001';await assert.rejects(verifyDeployment(rpc,hash),/runtime mismatch/);code=build.factory.deployedBytecode;
 childCode=true;await assert.rejects(verifyDeployment(rpc,hash),/code mismatch/);childCode=false;
 childFactory=other;await assert.rejects(verifyDeployment(rpc,hash),/factory binding/);childFactory=factory;
 age=301;await assert.rejects(verifyDeployment(rpc,hash),/recent chain snapshot/);age=-60;await assert.rejects(verifyDeployment(rpc,hash),/recent chain snapshot/);age=0;
 canonicalCreation=otherHash;await assert.rejects(verifyDeployment(rpc,hash),/current chain/);canonicalCreation=creationHash;
 transactionBlockHash=otherHash;await assert.rejects(verifyDeployment(rpc,hash),/current chain/);transactionBlockHash=creationHash;
 transactionHash=otherHash;await assert.rejects(verifyDeployment(rpc,hash),/current chain/);transactionHash=hash;
 inconsistentQuote=true;await assert.rejects(verifyDeployment(rpc,hash),/opening reference/);inconsistentQuote=false;
 stale=true;await assert.rejects(verifyDeployment(rpc,hash),/opening reference/);stale=false;
 badTerms=true;await assert.rejects(verifyDeployment(rpc,hash),/economics/);badTerms=false;
 reorganized=true;await assert.rejects(verifyDeployment(rpc,hash),/reorganized/);
 console.log('PASS: V5 creation/runtime, hook permissions and bindings, canonical recent snapshot, stale/reorganized RPC rejection, opening economics and zero-value deployment. No signing.');
})().catch(e=>{console.error(e);process.exitCode=1});
