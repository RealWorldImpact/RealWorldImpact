// Read-only verification: never sends a transaction or activates a deployment.
const fs=require('fs'),path=require('path');
const {JsonRpcProvider,keccak256,getCreateAddress}=require('../launch/node_modules/ethers');
const build=JSON.parse(fs.readFileSync(path.join(__dirname,'../../assets/vote-native-contract.json')));
async function verifyDeployment(rpc,transaction){
 if(!/^0x[0-9a-f]{64}$/i.test(transaction||''))throw Error('A deployment transaction hash is required.');
 if((await rpc.getNetwork()).chainId!==4663n)throw Error('Wrong network');
 const [tx,r,head]=await Promise.all([rpc.getTransaction(transaction),rpc.getTransactionReceipt(transaction),rpc.getBlock('latest')]);
 if(!tx||!r||r.status!==1||!r.contractAddress||tx.to!==null||tx.value!==0n||tx.data!==build.bytecode||tx.hash.toLowerCase()!==transaction.toLowerCase()||r.hash!==tx.hash||Number(tx.chainId)!==4663)throw Error('Transaction differs from the reviewed deployment.');
 if(!head||Math.abs(Math.floor(Date.now()/1000)-head.timestamp)>300)throw Error('A recent chain snapshot is required.');
 const block=await rpc.getBlock(r.blockNumber),address=r.contractAddress;
 if(block?.hash!==r.blockHash||tx.blockHash!==r.blockHash||tx.blockNumber!==r.blockNumber||r.blockNumber>head.number||getCreateAddress(tx).toLowerCase()!==address.toLowerCase())throw Error('Noncanonical or mismatched receipt.');
 if(keccak256(await rpc.getCode(address,head.number))!==build.runtimeHash||(await rpc.getBlock(head.number))?.hash!==head.hash)throw Error('Runtime or chain snapshot mismatch.');
 return {version:3,status:'awaiting_source_verification',chainId:4663,address,block:r.blockNumber,transaction:tx.hash,runtimeHash:build.runtimeHash,sourceVerified:false,deploymentBlockHash:r.blockHash,verifiedAtBlock:head.number};
}
module.exports={verifyDeployment};
if(require.main===module)(async()=>{const rpc=new JsonRpcProvider('https://rpc.mainnet.chain.robinhood.com');try{console.log(JSON.stringify(await verifyDeployment(rpc,process.argv[2]),null,2));}finally{rpc.destroy();}})().catch(e=>{console.error(e.message);process.exitCode=1;});
