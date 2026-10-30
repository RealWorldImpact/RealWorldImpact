const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),esbuild=require('esbuild'),{Interface}=require('ethers');
function load(name){const file=path.join(os.tmpdir(),'lp-'+name+'-'+process.pid+'.cjs');esbuild.buildSync({entryPoints:[path.join(__dirname,name+'.js')],outfile:file,bundle:true,platform:'node',format:'cjs'});const result=require(file);fs.unlinkSync(file);return result;}
const {uncollectedFees}=load('position-fees'),{volumeWindow,sumPoolVolume,SWAP_TOPIC,POOL_MANAGER}=load('pool-volume');
const q=1n<<128n;
assert.deepEqual(uncollectedFees([100n,q,q],[2n*q,3n*q]),[100n,200n]);
assert.deepEqual(uncollectedFees([q,(1n<<256n)-1n,0n],[0n,1n]),[1n,1n]);
assert.deepEqual(uncollectedFees([0n,q,q],[q,q]),[0n,0n]);assert.equal(uncollectedFees(null,[q,q]),null);
const pool='0x'+'a'.repeat(64),other='0x'+'b'.repeat(64),swap=new Interface(['event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)']);
const encoded=swap.encodeEventLog('Swap',[pool,'0x'+'1'.repeat(40),-200n,300n,1n,100n,0,10000]);assert.equal(encoded.topics[0],SWAP_TOPIC);
const log={address:POOL_MANAGER,...encoded},rows=sumPoolVolume([log,log,{...log,address:'0x'+'2'.repeat(40)}],[pool,other]);assert.deepEqual(rows[pool],{amount0:'400',amount1:'600',swaps:2});assert.equal(rows[other].swaps,0);assert.throws(()=>sumPoolVolume([{...log,data:'0x'}],[pool]));
(async()=>{
 const head=1000000,base=1000000,rpc=async(method,params)=>{assert.equal(method,'eth_getBlockByNumber');const n=params[0]==='latest'?head:Number(BigInt(params[0]));return {number:'0x'+n.toString(16),timestamp:'0x'+(base+n*2).toString(16)};};
 const cutoff=base+head*2-86400+1,window=await volumeWindow(rpc,cutoff);assert.equal(window.fromBlock,Math.ceil((cutoff-base)/2));assert.equal(window.toBlock,head);const empty=await volumeWindow(rpc,base+head*2+1);assert(empty.fromBlock>empty.toBlock);
 console.log('PASS: Q128 accrued fees, uint256 wraparound, zero fees, exact 24h block boundary, signed swap amounts, correct pool/manager filters and invalid data.');
})().catch(e=>{console.error(e);process.exitCode=1});
