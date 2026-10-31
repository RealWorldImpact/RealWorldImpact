import { Interface, formatUnits, getAddress, zeroPadValue } from 'ethers';
import { LAUNCH_V5_FACTORY as FACTORY, LAUNCH_V5_BLOCK as FIRST_BLOCK } from '../launch-v5-config.js';
import { LAUNCH_V5_ABI } from '../launch-v5-contract.js';
import { uploadedImageUrl } from '../launch-image-policy.js';

const RPC='https://rpc.mainnet.chain.robinhood.com',ORIGIN='https://www.rwihood.org';
export const RWI='0xda2598c976e62e7e15dcca75169b404712e48b04';
export const MAX_BLOCK_RANGE=256;
const ZERO='0x'+'0'.repeat(40),factory=new Interface(LAUNCH_V5_ABI);
const erc20=new Interface(['function name() view returns(string)','function symbol() view returns(string)','function totalSupply() view returns(uint256)','function logo() view returns(string)']);
const names=['TokenLaunched','CurveTrade','PoolGraduated'],topics=names.map(n=>factory.getEvent(n).topicHash);
const fail=(code,message)=>Object.assign(Error(message),{status:code});
const hex=n=>'0x'+n.toString(16),num=v=>{if(typeof v!=='string'||!/^0x[\da-f]+$/i.test(v))throw Error('Invalid RPC integer');const n=Number(BigInt(v));if(!Number.isSafeInteger(n)||n<0)throw Error('Invalid RPC integer');return n;};
const amount=v=>formatUnits(v,18),address=v=>{try{if(typeof v!=='string'||v.toLowerCase()===ZERO)throw Error();return getAddress(v).toLowerCase();}catch{throw fail(400,'A valid nonzero id address is required.');}};
const integer=(v,name)=>{if(typeof v!=='string'||!/^\d{1,16}$/.test(v)||!Number.isSafeInteger(Number(v)))throw fail(400,name+' must be a non-negative integer.');return Number(v);};
const hash=v=>typeof v==='string'&&/^0x[\da-f]{64}$/i.test(v);
const publicBlock=b=>({blockNumber:num(b.number),blockTimestamp:num(b.timestamp)});
function blockValid(b){if(!b||!hash(b.hash))throw Error('Block unavailable');publicBlock(b);return b;}
function boundedSet(cache,key,value,max=256){if(cache.size>=max)cache.delete(cache.keys().next().value);cache.set(key,value);return value;}
async function mapLimit(items,fn,size=6){const result=[];for(let i=0;i<items.length;i+=size)result.push(...await Promise.all(items.slice(i,i+size).map(fn)));return result;}

export async function readRpc(method,params){
 const r=await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(12000)});
 if(!r.ok)throw Error('Chain read unavailable');const b=await r.json();if(b.id!==1||b.error||b.result===undefined)throw Error('Incomplete chain read');return b.result;
}

// All math uses accounted curve reserves, excluding phantom RWI, rewards and donations.
export function applyCurveEvent(state,event){
 const a=event.args;
 if(event.name==='TokenLaunched'){
  if(state)throw Error('Duplicate creation');return {tokens:a.initialInventory,quote:0n,initial:a.initialInventory,phase:0};
 }
 if(!state||state.phase!==0)throw Error('Trade outside active curve');
 if(event.name==='CurveTrade'){
  if(a.tokenAmount<=0n||a.rwiAmount<=0n||a.fee<0n)throw Error('Invalid trade');
  if(a.buy){if(a.fee>=a.rwiAmount)throw Error('Invalid fee');state.tokens-=a.tokenAmount;state.quote+=a.rwiAmount-a.fee;}
  else{state.tokens+=a.tokenAmount;state.quote-=a.rwiAmount+a.fee;}
  if(state.tokens<0n||state.tokens>state.initial||state.quote<0n)throw Error('Invalid reserves');
 }else if(event.name==='PoolGraduated')state.phase=2;
 return state;
}

export function createDextoolsAdapter({rpc=readRpc,clock=Date.now,onError=()=>{}}={}){
 let headCache;const blocks=new Map(),creations=new Map(),eventsCache=new Map(),histories=new Map();
 async function block(tag){const b=blockValid(await rpc('eth_getBlockByNumber',[typeof tag==='number'?hex(tag):tag,false]));if(typeof tag==='number'&&num(b.number)!==tag)throw Error('Wrong block');return b;}
 async function byNumber(n){return blocks.get(n)||boundedSet(blocks,n,await block(n),512);}
 async function head(){
  if(headCache&&clock()-headCache.at<3000)return headCache.b;
  const b=await block('finalized');if(num(b.timestamp)*1000>clock()+30000)throw Error('Future block');
  // Prove the finalized head's logs are available before advertising it to the indexer.
  await logs(num(b.number),num(b.number));
  if((await block(num(b.number))).hash!==b.hash)throw Error('Finalized block changed');
  headCache={b,at:clock()};return b;
 }
 async function logs(from,to,extraTopics){
  const rows=await rpc('eth_getLogs',[{address:FACTORY,fromBlock:hex(from),toBlock:hex(to),topics:extraTopics||[topics]}]);
  if(!Array.isArray(rows)||rows.length>1000)throw fail(503,'Reduce the block range; the response cannot be returned completely.');
  const seen=new Set();
  for(const l of rows){const bn=num(l.blockNumber),key=bn+':'+num(l.logIndex);if(l.removed||address(l.address)!==FACTORY.toLowerCase()||bn<from||bn>to||!hash(l.blockHash)||!hash(l.transactionHash)||seen.has(key)||!topics.includes(l.topics?.[0]))throw Error('Invalid log');seen.add(key);num(l.transactionIndex);}
  return rows.sort((a,b)=>num(a.blockNumber)-num(b.blockNumber)||num(a.logIndex)-num(b.logIndex));
 }
 async function call(to,iface,name,args,at){return iface.decodeFunctionResult(name,await rpc('eth_call',[{to,data:iface.encodeFunctionData(name,args)},hex(at)]));}
 async function record(token,at){return call(FACTORY,factory,'launches',[token],at);}
 async function known(token){const b=await block('latest'),l=await record(token,num(b.number));if(l.creator.toLowerCase()===ZERO)throw fail(404,'Token is not in the RWI V5 registry.');return l;}
 async function canonical(b){if((await block(num(b.number))).hash!==b.hash){blocks.clear();eventsCache.clear();creations.clear();histories.clear();headCache=null;throw Error('Chain snapshot changed; retry.');}}
 async function atTimestamp(timestamp,high){
  const first=await byNumber(0);if(timestamp<num(first.timestamp))throw fail(404,'No block exists at this timestamp.');
  let low=0;while(low<high){const mid=Math.ceil((low+high)/2);if(num((await byNumber(mid)).timestamp)<=timestamp)low=mid;else high=mid-1;}return byNumber(low);
 }
 async function creation(token,l,h){
  if(Number(l.launchedAt)>num(h.timestamp))throw fail(404,'Token creation has not reached the finalized feed yet.');
  if(creations.has(token))return creations.get(token);
  const end=await atTimestamp(Number(l.launchedAt),num(h.number));const before=await atTimestamp(Number(l.launchedAt)-1,num(h.number));
  const found=await logs(Math.max(FIRST_BLOCK,num(before.number)+1),num(end.number),[topics[0],zeroPadValue(token,32)]);
  const matches=found.filter(x=>factory.parseLog(x).args.token.toLowerCase()===token);
  if(matches.length!==1)throw Error('Creation event unavailable');const b=await byNumber(num(matches[0].blockNumber));if(b.hash!==matches[0].blockHash)throw Error('Noncanonical creation');
  return boundedSet(creations,token,{log:matches[0],block:b});
 }
 async function span(from,to,token){
  if(to<from)return [];if(to-from+1>6400000)throw fail(503,'Cold historical replay exceeds the service limit; a persistent index is required for this range.');
  const out=[];for(let n=from;n<=to;n+=100000){out.push(...await logs(n,Math.min(n+99999,to),[topics,zeroPadValue(token,32)]));if(out.length>10000)throw fail(503,'Historical replay exceeds the service limit; no partial history returned.');}return out;
 }
 async function historyAt(token,to,h){
  const l=await known(token),c=await creation(token,l,h),start=num(c.block.number);if(to<start)return null;
  const cached=histories.get(token);let state=cached&&cached.at<=to?{...cached.state}:undefined,from=state?cached.at+1:start;
  for(const log of await span(from,to,token))state=applyCurveEvent(state,factory.parseLog(log));
  if(!state)throw Error('Creation history missing');boundedSet(histories,token,{at:to,state:{...state}});return state;
 }
 async function events(from,to,h){
  if(to<from||to-from+1>MAX_BLOCK_RANGE)throw fail(400,'Request an inclusive range of at most '+MAX_BLOCK_RANGE+' blocks.');
  if(to>num(h.number))throw fail(400,'toBlock exceeds latest-block. Retry after finalization.');
  if(to<FIRST_BLOCK)return {events:[]};from=Math.max(from,FIRST_BLOCK);
  const last=await block(to),key=from+':'+last.hash;
  if(eventsCache.has(key))return eventsCache.get(key);
  const rows=await logs(from,to),tokens=[...new Set(rows.map(l=>factory.parseLog(l).args.token.toLowerCase()))],states=new Map();
  await mapLimit(tokens,async t=>{const state=await historyAt(t,from-1,h);if(state)states.set(t,state);});
  const receipts=new Map();await mapLimit([...new Set(rows.map(l=>l.transactionHash))],async id=>{const r=await rpc('eth_getTransactionReceipt',[id]);if(!r||r.transactionHash!==id||num(r.status)!==1||!Array.isArray(r.logs))throw Error('Receipt unavailable');receipts.set(id,r);});
  const output=[],migrations=[];
  for(const log of rows){
   const b=await byNumber(num(log.blockNumber)),receipt=receipts.get(log.transactionHash);
   if(b.hash!==log.blockHash||receipt.blockHash!==b.hash||num(receipt.blockNumber)!==num(log.blockNumber)||num(receipt.transactionIndex)!==num(log.transactionIndex)||!receipt.logs.some(x=>num(x.logIndex)===num(log.logIndex)&&x.address.toLowerCase()===FACTORY.toLowerCase()&&x.data===log.data&&JSON.stringify(x.topics)===JSON.stringify(log.topics)))throw Error('Log/receipt mismatch');
   const event=factory.parseLog(log),a=event.args,token=a.token.toLowerCase(),state=applyCurveEvent(states.get(token),event);states.set(token,state);
   const common={block:publicBlock(b),txnId:log.transactionHash,txnIndex:num(log.transactionIndex),eventIndex:num(log.logIndex),maker:address(receipt.from),pairId:token};
   if(event.name==='TokenLaunched')output.push({...common,eventType:'creation'});
   else if(event.name==='CurveTrade')output.push({...common,eventType:'swap',...(a.buy?{asset1In:amount(a.rwiAmount),asset0Out:amount(a.tokenAmount)}:{asset0In:amount(a.tokenAmount),asset1Out:amount(a.rwiAmount)}),reserves:{asset0:amount(state.tokens),asset1:amount(state.quote)},rwiCurve:{trader:a.trader.toLowerCase(),feeRwi:amount(a.fee),reserveBasis:'real-accounted-reserves'}});
   else migrations.push({...common,poolId:a.poolId,positionId:a.positionId.toString(),seededRwi:amount(a.rwiSeed),seededTokens:amount(a.tokenSeed)});
  }
  // The public RPC prunes old state. Continue replay to a recent pinned state
  // and reconcile there; the response itself only exposes finalized events.
  const live=await block('latest');
  await mapLimit(tokens,async t=>{const l=await record(t,num(live.number));let s={...states.get(t)};for(const log of await span(to+1,num(live.number),t))s=applyCurveEvent(s,factory.parseLog(log));if(l.tokenReserve!==s.tokens||l.quoteReserve!==s.quote||Number(l.phase)!==s.phase)throw Error('Incomplete curve history');});
  await canonical(live);
  await canonical(last);return boundedSet(eventsCache,key,{events:output,...(migrations.length?{rwiMigrations:migrations}:{})},64);
 }
 return async(req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');
  if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','GET, HEAD, OPTIONS');return res.status(204).end();}
  if(!['GET','HEAD'].includes(req.method))return res.status(405).json({code:'405',message:'Read-only API.'});
  try{
   const q=req.query||{},route=q.dextools;
   if(!['latest-block','block','asset','asset/holders','exchange','pair','events'].includes(route))throw fail(404,'Unknown adapter endpoint.');
   if(route==='asset/holders')throw fail(501,'Holder distribution is not provided by this market adapter. DEXTools must use its EVM holder index; exact fractional-balance support requires integration review.');
   let result;
   if(route==='exchange'){if(address(q.id)!==FACTORY.toLowerCase())throw fail(404,'Unknown exchange.');result={exchange:{factoryAddress:FACTORY.toLowerCase(),name:'RWI Launch Curves',logoURL:ORIGIN+'/assets/rwi-logo.webp'}};}
   else{
    const h=await head(),height=num(h.number);res.setHeader('X-RWI-Block-Hash',h.hash);res.setHeader('X-RWI-Finality','finalized');
    if(route==='latest-block')result={block:publicBlock(h)};
    else if(route==='block'){
     let b;if(q.number!==undefined){const n=integer(q.number,'number');if(n>height)throw fail(404,'Block is not finalized.');b=await byNumber(n);}else b=await atTimestamp(integer(q.timestamp,'timestamp'),height);
     result={block:publicBlock(b)};
    }else if(route==='events')result=await events(integer(q.fromBlock,'fromBlock'),integer(q.toBlock,'toBlock'),h);
    else{
     const id=address(q.id),l=id===RWI&&route==='asset'?null:await known(id);
     if(route==='asset'){
      if(l)await creation(id,l,h);const live=await block('latest');
      const [[name],[symbol],[supply]]=await Promise.all(['name','symbol','totalSupply'].map(n=>call(id,erc20,n,[],num(live.number))));
      let logo=id===RWI?ORIGIN+'/assets/rwi-logo.webp':null;if(l){const [raw]=await call(id,erc20,'logo',[],num(live.number));logo=uploadedImageUrl(raw)||null;}await canonical(live);
      result={asset:{id,name,symbol,totalSupply:amount(supply),decimals:18,...(logo?{logoURL:logo}:{}),...(l?{externalURL:ORIGIN+'/tokens/'+id}:{})}};
     }else{
      const c=await creation(id,l,h),state=await historyAt(id,height,h);result={pair:{id,asset0Id:id,asset1Id:RWI,createdAtBlockNumber:num(c.block.number),createdAtBlockTimestamp:num(c.block.timestamp),createdAtTxnId:c.log.transactionHash,factoryAddress:FACTORY.toLowerCase(),feeBps:100+Number(l.creatorTaxBps),rwiCurve:{phase:state.phase===2?'graduated':'bonding',poolId:state.phase===2?l.poolId:null,tradeURL:ORIGIN+'/LP?tab=launch&token='+id,phantomRwi:amount(l.phantomQuote),reserveBasis:'real-accounted-reserves',priceRequiresVirtualQuote:true}}};
     }
     await canonical(h);
    }
   }
   res.setHeader('Cache-Control','public, max-age=0, s-maxage=3');if(req.method==='HEAD')return res.status(200).end();return res.status(200).json(result);
  }catch(e){onError(e);return res.status(e.status||503).json({code:String(e.status||503),message:e.status?e.message:'The complete canonical market data could not be verified. Retry; no partial results were returned.'});}
 };
}
