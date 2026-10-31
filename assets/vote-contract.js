/* RWI contract votes: a zero-token ERC-20 transfer carrying an advisory memo.
   No approvals, token movement, native value, or deployed voting contract. */
(function(root){
  'use strict';
  const TOKEN='0xda2598c976e62e7e15dcca75169b404712e48b04';
  const INBOX='0x5257490000000000000000000000000000000000';
  const START_BLOCK=102914056;
  const TRANSFER='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  const WORD_INBOX=INBOX.slice(2).padStart(64,'0'),ZERO='0'.repeat(64);
  const PREFIX='0xa9059cbb'+WORD_INBOX+ZERO;
  const SCAN='https://robinhoodchain.blockscout.com';
  const hash=v=>typeof v==='string'&&/^0x[0-9a-f]{64}$/i.test(v);
  const address=v=>typeof v==='string'&&/^0x[0-9a-f]{40}$/i.test(v)&&!/^0x0{40}$/i.test(v);
  const number=v=>{if(!/^(?:0x[\da-f]+|\d+)$/i.test(String(v)))throw Error('Invalid chain number');const n=Number(BigInt(v));if(!Number.isSafeInteger(n)||n<0)throw Error('Invalid chain number');return n;};
  const hex=n=>'0x'+n.toString(16);
  function memoParts(memo){
    const m=/^RWIVOTE:([1-9][0-9]{0,15}):([a-z0-9][a-z0-9-]{0,95})$/.exec(memo);
    if(!m||!Number.isSafeInteger(Number(m[1])))return null;
    return {round:Number(m[1]),slug:m[2],memo};
  }
  function makeVote(round,slug){
    const p=memoParts('RWIVOTE:'+round+':'+slug);if(!p)throw Error('Invalid round or charity slug');
    const memoHex=Array.from(new TextEncoder().encode(p.memo),b=>b.toString(16).padStart(2,'0')).join('');
    return {chainId:4663,to:TOKEN,value:'0',data:PREFIX+memoHex};
  }
  function parseVoteInput(data){
    if(typeof data!=='string'||data.length>PREFIX.length+256||data.length%2!==0||!/^0x[\da-f]+$/i.test(data)||!data.toLowerCase().startsWith(PREFIX))return null;
    const tail=data.slice(PREFIX.length);if(!tail)return null;
    try{return memoParts(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(tail.match(/../g),h=>parseInt(h,16))));}catch{return null;}
  }
  function verifyVote(tx,receipt){
    if(!tx||!receipt)throw Error('Vote transaction is not available yet');
    if(!address(tx.from)||tx.to?.toLowerCase()!==TOKEN||number(tx.value)!==0||number(receipt.status)!==1)return null;
    const p=parseVoteInput(tx.input||tx.data);if(!p)return null;
    if(!hash(tx.hash)||receipt.transactionHash?.toLowerCase()!==tx.hash.toLowerCase()||!hash(tx.blockHash)||receipt.blockHash?.toLowerCase()!==tx.blockHash.toLowerCase()
      ||number(tx.blockNumber)!==number(receipt.blockNumber)||number(tx.transactionIndex)!==number(receipt.transactionIndex)
      ||receipt.from?.toLowerCase()!==tx.from.toLowerCase()||receipt.to?.toLowerCase()!==TOKEN||!Array.isArray(receipt.logs))throw Error('Vote receipt does not match transaction');
    const fromWord=tx.from.toLowerCase().slice(2).padStart(64,'0');
    // transferFrom(victim, inbox, 0) needs no allowance on standard ERC-20s.
    // Only a DIRECT transfer call signed by the voter is accepted; logs alone
    // never authenticate a voter. Multicalls/relayers are not accepted here.
    const proof=receipt.logs.filter(l=>l.address?.toLowerCase()===TOKEN&&l.topics?.length===3&&l.topics[0]?.toLowerCase()===TRANSFER
      &&l.topics[1]?.toLowerCase()==='0x'+fromWord&&l.topics[2]?.toLowerCase()==='0x'+WORD_INBOX&&l.data?.toLowerCase()==='0x'+ZERO&&!l.removed);
    if(proof.length!==1)return null;
    const log=proof[0];if(log.transactionHash?.toLowerCase()!==tx.hash.toLowerCase()||log.blockHash?.toLowerCase()!==tx.blockHash.toLowerCase()
      ||number(log.blockNumber)!==number(tx.blockNumber)||number(log.transactionIndex)!==number(tx.transactionIndex))throw Error('Vote event mismatch');
    return {hash:tx.hash.toLowerCase(),from:tx.from.toLowerCase(),to:INBOX,value:'0',input:'0x'+Array.from(new TextEncoder().encode(p.memo),b=>b.toString(16).padStart(2,'0')).join(''),
      block_number:number(tx.blockNumber),index:number(tx.transactionIndex),status:'ok',result:'success',block_hash:tx.blockHash.toLowerCase(),vote_transport:'rwi-zero-transfer'};
  }
  function createReader(){
    const verified=new Map();let recent=null;
    const bounded=(k,v)=>{if(verified.size>=2048)verified.delete(verified.keys().next().value);verified.set(k,v);};
    return async function readVotes({rpc,fetcher,fromBlock=START_BLOCK}){
      const start=Math.max(START_BLOCK,number(fromBlock));
      const [head,finalized]=await Promise.all([rpc('eth_getBlockByNumber',['latest',false]),rpc('eth_getBlockByNumber',['finalized',false])]);
      if(!hash(head?.hash)||!hash(finalized?.hash))throw Error('Vote chain head unavailable');
      const end=number(head.number),finalHeight=number(finalized.number);if(start>end)return {rows:[],truncated:false};
      const ids=new Set(),cursors=new Set();let truncated=false;
      let url=SCAN+'/api/v2/addresses/'+INBOX+'/token-transfers?type=ERC-20&filter=to';
      for(let page=0;page<20;page++){
        const r=await fetcher(url,{headers:{accept:'application/json'}});if(!r.ok)throw Error('Contract vote history unavailable');
        const j=await r.json();if(!Array.isArray(j.items))throw Error('Incomplete contract vote history');
        for(const item of j.items){if(number(item.block_number)<start||number(item.block_number)>end)continue;
          if(item.token?.address_hash?.toLowerCase()===TOKEN&&item.to?.hash?.toLowerCase()===INBOX&&item.total?.value==='0'){
            if(!hash(item.transaction_hash))throw Error('Invalid indexed vote');ids.add(item.transaction_hash.toLowerCase());
          }
        }
        if(!j.next_page_params||j.items.length&&j.items.every(x=>number(x.block_number)<start))break;
        if(page===19){truncated=true;break;}
        const query=new URLSearchParams(j.next_page_params).toString();if(cursors.has(query))throw Error('Repeated vote cursor');cursors.add(query);
        url=SCAN+'/api/v2/addresses/'+INBOX+'/token-transfers?type=ERC-20&filter=to&'+query;
      }
      // Cover explorer indexing lag using a narrowly filtered recent chain read.
      // Older history comes from the paginated index, so cold reads do not grow
      // with chain age. Recheck the prior tip before reusing this small cache.
      const low=Math.max(start,end-99999);
      if(recent&&(recent.end>end||recent.low>low||(await rpc('eth_getBlockByNumber',[hex(recent.end),false]))?.hash!==recent.hash))recent=null;
      const from=recent?Math.max(low,recent.end+1):low;
      const old=recent?recent.logs.filter(l=>number(l.blockNumber)>=low):[];
      const logs=from<=end?await rpc('eth_getLogs',[{address:TOKEN,fromBlock:hex(from),toBlock:hex(end),topics:[TRANSFER,null,'0x'+WORD_INBOX]}]):[];
      if(!Array.isArray(logs)||logs.length>=1000)throw Error('Contract vote log window is incomplete');
      for(const l of logs){if(l.address?.toLowerCase()!==TOKEN||l.topics?.[0]?.toLowerCase()!==TRANSFER||l.topics?.[2]?.toLowerCase()!=='0x'+WORD_INBOX
        ||number(l.blockNumber)<from||number(l.blockNumber)>end||!hash(l.transactionHash)||l.removed)throw Error('Invalid vote log');}
      const combined=[...old,...logs];for(const l of combined)if(l.data?.toLowerCase()==='0x'+ZERO)ids.add(l.transactionHash.toLowerCase());
      const rows=[];
      const list=[...ids];for(let n=0;n<list.length;n+=4)await Promise.all(list.slice(n,n+4).map(async id=>{
        let row=verified.get(id);if(row&&row.block_number<=finalHeight){rows.push(row);return;}
        const [tx,receipt]=await Promise.all([rpc('eth_getTransactionByHash',[id]),rpc('eth_getTransactionReceipt',[id])]);row=verifyVote(tx,receipt);
        if(!row)return;const block=await rpc('eth_getBlockByNumber',[hex(row.block_number),false]);if(block?.hash?.toLowerCase()!==row.block_hash)throw Error('Vote block changed');
        if(row.block_number<start||row.block_number>end)return;if(row.block_number<=finalHeight)bounded(id,row);rows.push(row);
      }));
      if((await rpc('eth_getBlockByNumber',[hex(end),false]))?.hash!==head.hash)throw Error('Vote chain changed; retry');
      recent={low,end,hash:head.hash,logs:combined};return {rows,truncated};
    };
  }
  root.RWIContractVotes=Object.freeze({TOKEN,INBOX,START_BLOCK,TRANSFER,PREFIX,makeVote,parseVoteInput,verifyVote,createReader});
})(globalThis);
