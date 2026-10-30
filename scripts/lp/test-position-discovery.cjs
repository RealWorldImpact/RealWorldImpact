const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),esbuild=require('esbuild'),{id}=require('ethers');
const file=path.join(os.tmpdir(),'lp-position-discovery-'+process.pid+'.cjs');esbuild.buildSync({entryPoints:[path.join(__dirname,'position-discovery.js')],outfile:file,bundle:true,platform:'node',format:'cjs',nodePaths:require('module').globalPaths});const {discoverPositionIds}=require(file);fs.unlinkSync(file);
const manager='0x'+'1'.repeat(40),wallet='0x'+'2'.repeat(40),topic='0x'+wallet.slice(2).padStart(64,'0');
const log=n=>({address:manager,topics:[id('Transfer(address,address,uint256)'),'0x'+'0'.repeat(64),topic,'0x'+BigInt(n).toString(16).padStart(64,'0')]});
(async()=>{
 let calls=[];const rpc={getBlockNumber:async()=>21000000,getLogs:async filter=>{calls.push(filter);assert.equal(filter.address,manager);assert.equal(filter.topics[2],topic);assert(filter.toBlock-filter.fromBlock<10000000);return [log(42),log(42),{...log(99),address:wallet}];}};
 const first=await discoverPositionIds(rpc,manager,wallet);assert.equal(calls.length,3);assert.deepEqual(first.ids,['42']);assert.equal(first.partial,false);
 calls=[];const next=await discoverPositionIds(rpc,manager,wallet,first);assert.equal(calls.length,1);assert.equal(calls[0].fromBlock,first.block-16);assert.deepEqual(next.ids,['42']);
 rpc.getLogs=async()=>{throw Error('offline')};const partial=await discoverPositionIds(rpc,manager,wallet,first);assert.equal(partial.partial,true);assert.deepEqual(partial.ids,['42']);
 console.log('PASS: wallet-filtered onchain NFT discovery, bounded RPC ranges, deduplication, correct manager, incremental updates and partial outage handling.');
})().catch(e=>{console.error(e);process.exitCode=1});
