const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Interface}=require('ethers'),esbuild=require('esbuild');
const file=path.join(os.tmpdir(),'lp-market-test-'+process.pid+'.cjs');
esbuild.buildSync({entryPoints:[path.join(__dirname,'market-discovery.js')],outfile:file,bundle:true,platform:'node',format:'cjs'});
const {balanceBatch,readBalanceBatch,discoverMarketHoldings}=require(file);fs.unlinkSync(file);
const iface=new Interface(['function aggregate3((address target,bool allowFailure,bytes callData)[] calls) returns ((bool success,bytes returnData)[])']);
const wallet='0x9cd7c9196a4c1836a3df089cb210272e07e6a5e5',weall='0x46d885131efeb8f6ab5736f17f2b3a2f44588ba3';
const tokens=[{address:weall},{address:'0x'+'1'.repeat(40)}],balance='0x'+(123n).toString(16).padStart(64,'0');
const calls=tokens.map(t=>[t.address,true,'0x70a08231'+wallet.slice(2).padStart(64,'0')]);
assert.equal(balanceBatch(tokens,wallet),iface.encodeFunctionData('aggregate3',[calls]));
assert.deepEqual(readBalanceBatch(iface.encodeFunctionResult('aggregate3',[[[true,balance],[false,'0x']]]),2),[123n,null]);
assert.throws(()=>readBalanceBatch('0x',2));
assert.throws(()=>readBalanceBatch(iface.encodeFunctionResult('aggregate3',[[]]),2));
(async()=>{
  const original=global.fetch;let priceCalls=0,rpcCalls=0;
  try{
    global.fetch=async(url,options)=>{
      if(url==='https://rpc.mainnet.chain.robinhood.com'){
        rpcCalls++;const request=JSON.parse(options.body);assert.equal(request.method,'eth_call');
        const decoded=iface.decodeFunctionData('aggregate3',request.params[0].data)[0];
        const results=decoded.map(c=>[true,'0x'+(c.target.toLowerCase()===weall?123n:0n).toString(16).padStart(64,'0')]);
        return {ok:true,json:async()=>({result:iface.encodeFunctionResult('aggregate3',[results])})};
      }
      priceCalls++;assert.equal(url,'https://api.geckoterminal.com/api/v2/networks/robinhood/tokens/'+weall);assert(!url.includes(wallet));
      return {ok:true,json:async()=>({data:{attributes:{address:weall,price_usd:'0.00000022',image_url:'https://example.com/weall.png'}}})};
    };
    const result=await discoverMarketHoldings(wallet);assert.equal(result.tokens.length,1);assert.equal(result.tokens[0].address,weall);assert.equal(result.tokens[0].priceUsd,'0.00000022');assert.equal(result.failed,false);assert.equal(rpcCalls,1);assert.equal(priceCalls,1);
    global.fetch=async()=>{throw Error('RPC offline')};await assert.rejects(discoverMarketHoldings(wallet));
    console.log('PASS: Uniswap candidates, exact multicall encoding/decoding, zero/reverted balances, automatic weallmfers discovery, USD price and wallet privacy.');
  }finally{global.fetch=original;}
})().catch(e=>{console.error(e);process.exitCode=1});
