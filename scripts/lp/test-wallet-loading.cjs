const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),esbuild=require('esbuild');
const {Interface}=require('ethers');
function load(name){const file=path.join(os.tmpdir(),'lp-'+name+'-'+process.pid+'.cjs');esbuild.buildSync({entryPoints:[path.join(__dirname,name+'.js')],outfile:file,bundle:true,platform:'node',format:'cjs',nodePaths:require('module').globalPaths});const result=require(file);fs.unlinkSync(file);return result;}
const {walletCandidates}=load('wallet-providers'),{readWalletHoldings}=load('wallet-balances');
const modern={request:async()=>{},isMetaMask:true},legacy={request:async()=>{},isMetaMask:true},other={request:async()=>{}};
assert.deepEqual(walletCandidates([{name:'MetaMask',provider:modern}],legacy).map(c=>c.name),['MetaMask']);
assert.equal(walletCandidates([{name:'MetaMask',provider:modern},{name:'MetaMask',provider:modern}],legacy).length,1);
assert.equal(walletCandidates([{name:'MetaMask',provider:modern},{name:'Other',provider:other}],legacy).length,2);
assert.equal(walletCandidates([],{providers:[legacy,legacy]}).length,1);
assert.equal(walletCandidates([],legacy)[0].provider,legacy);
assert.equal(walletCandidates([],undefined).length,0);
const m=new Interface(['function aggregate3((address target,bool allowFailure,bytes callData)[] calls) view returns ((bool success,bytes returnData)[])']);
const e=new Interface(['function balanceOf(address) view returns(uint256)','function decimals() view returns(uint8)']);
const wallet='0x'+'a'.repeat(40),tokens=Array.from({length:53},(_,i)=>({address:'0x'+(i+1).toString(16).padStart(40,'0'),symbol:'T'+i,priceUsd:'1'}));
(async()=>{
  let requests=0;
  const call=async req=>{
    requests++;assert.equal(req.to,'0xca11bde05977b3631167028862be2a173976ca11');
    const calls=m.decodeFunctionData('aggregate3',req.data)[0];
    const result=calls.map((c,i)=>{
      assert(c.allowFailure);
      if(i%2===0){assert.equal(e.decodeFunctionData('balanceOf',c.callData)[0].toLowerCase(),wallet);return [true,e.encodeFunctionResult('balanceOf',[i===0?0n:123n])];}
      return i===3?[false,'0x']:[true,e.encodeFunctionResult('decimals',[18])];
    });
    return m.encodeFunctionResult('aggregate3',[result]);
  };
  const result=await readWalletHoldings(tokens,wallet,call);
  assert.equal(requests,1);assert.equal(result.rows.length,51);assert.equal(result.failed,1);assert.equal(result.rows[0].balance,'123');assert.equal(result.rows[0].decimals,18);
  await assert.rejects(readWalletHoldings(tokens,wallet,async()=>{throw Error('offline')}),/temporarily unavailable/);
  assert.deepEqual(await readWalletHoldings([],wallet,call),{rows:[],failed:0});
  console.log('PASS: duplicate MetaMask discovery, multiple modern wallets, legacy fallback, 53 tokens in one RPC call, onchain decimals, zero/reverted reads and RPC failure.');
})().catch(e=>{console.error(e);process.exitCode=1});
