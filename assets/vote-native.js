/* Standard ABI voting. This contract records msg.sender; it has no token calls. */
(function(root){
  'use strict';
  const build=root.RWIVoteBuild, legacy=root.RWIContractVotes;
  const validAddress=v=>typeof v==='string'&&/^0x[0-9a-f]{40}$/i.test(v)&&!/^0x0{40}$/i.test(v);
  const validHash=v=>typeof v==='string'&&/^0x[0-9a-f]{64}$/i.test(v);
  const hexText=s=>Array.from(new TextEncoder().encode(s),b=>b.toString(16).padStart(2,'0')).join('');
  const word=n=>BigInt(n).toString(16).padStart(64,'0');
  const safeNumber=n=>{const value=BigInt(n);if(value<0n||value>BigInt(Number.MAX_SAFE_INTEGER))throw Error('Invalid vote number');return Number(value);};
  const validChoice=(round,slug)=>Number.isSafeInteger(round)&&round>0&&typeof slug==='string'&&/^[a-z0-9][a-z0-9-]{0,95}$/.test(slug);
  function activeDeployment(config){
    if(config?.version!==3||config.chainId!==4663||config.runtimeHash!==build.runtimeHash)throw Error('Unknown voting deployment');
    if(config.status==='awaiting_deployment'&&!config.address)return null;
    if(config.status!=='active'||config.sourceVerified!==true||!validAddress(config.address)||!Number.isSafeInteger(config.block)||config.block<=0||!validHash(config.transaction))throw Error('Unverified voting deployment');
    return {...config,address:config.address.toLowerCase()};
  }
  function encodeChoice(round,slug){
    if(!validChoice(round,slug))throw Error('Invalid round or charity');
    const text=hexText(slug);return build.selector+word(round)+word(64)+word(text.length/2)+text.padEnd(Math.ceil(text.length/64)*64,'0');
  }
  function makeVote(config,round,slug){
    const deployment=activeDeployment(config);if(!deployment)throw Error('Voting contract is not deployed');
    return {chainId:4663,to:deployment.address,value:'0',data:encodeChoice(round,slug)};
  }
  function parseVoteInput(data){
    if(typeof data!=='string'||!/^0x[0-9a-f]+$/i.test(data)||!data.toLowerCase().startsWith(build.selector)||data.length<266||data.length>394)return null;
    try{
      if(data.slice(74,138).toLowerCase()!==word(64))return null;
      const round=safeNumber('0x'+data.slice(10,74)),len=safeNumber('0x'+data.slice(138,202));
      if(len<1||len>96||data.length!==202+Math.ceil(len/32)*64)return null;
      const slug=new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(data.slice(202,202+len*2).match(/../g),h=>parseInt(h,16)));
      if(!validChoice(round,slug)||encodeChoice(round,slug)!==data.toLowerCase())return null;
      return {round,slug,memo:'RWIVOTE:'+round+':'+slug};
    }catch{return null;}
  }
  function verifyVote(config,tx,receipt){
    const d=activeDeployment(config);if(!d)throw Error('Voting contract unavailable');
    if(!tx||!receipt)throw Error('Vote transaction is not available yet');
    if(!validAddress(tx.from)||tx.to?.toLowerCase()!==d.address||BigInt(tx.value)!==0n||BigInt(receipt.status)!==1n)return null;
    const p=parseVoteInput(tx.input||tx.data);if(!p)return null;
    if(!validHash(tx.hash)||receipt.transactionHash?.toLowerCase()!==tx.hash.toLowerCase()||!validHash(tx.blockHash)||receipt.blockHash?.toLowerCase()!==tx.blockHash.toLowerCase()
      ||safeNumber(tx.blockNumber)!==safeNumber(receipt.blockNumber)||safeNumber(tx.transactionIndex)!==safeNumber(receipt.transactionIndex)
      ||receipt.from?.toLowerCase()!==tx.from.toLowerCase()||receipt.to?.toLowerCase()!==d.address||!Array.isArray(receipt.logs))throw Error('Vote receipt mismatch');
    const str=hexText(p.slug),data='0x'+word(32)+word(str.length/2)+str.padEnd(Math.ceil(str.length/64)*64,'0');
    const proof=receipt.logs.filter(l=>l.address?.toLowerCase()===d.address&&l.topics?.length===3&&l.topics[0]?.toLowerCase()===build.eventTopic
      &&l.topics[1]?.toLowerCase()==='0x'+tx.from.toLowerCase().slice(2).padStart(64,'0')&&l.topics[2]?.toLowerCase()==='0x'+word(p.round)&&l.data?.toLowerCase()===data&&!l.removed);
    if(proof.length!==1)return null;
    const log=proof[0];if(log.transactionHash?.toLowerCase()!==tx.hash.toLowerCase()||log.blockHash?.toLowerCase()!==tx.blockHash.toLowerCase()
      ||safeNumber(log.blockNumber)!==safeNumber(tx.blockNumber)||safeNumber(log.transactionIndex)!==safeNumber(tx.transactionIndex))throw Error('Vote event mismatch');
    return {hash:tx.hash.toLowerCase(),from:tx.from.toLowerCase(),to:d.address,value:'0',input:'0x'+hexText(p.memo),block_number:safeNumber(tx.blockNumber),index:safeNumber(tx.transactionIndex),status:'ok',result:'success',block_hash:tx.blockHash.toLowerCase(),vote_transport:'vote-method'};
  }
  let configCache=null,configAt=0,inflight=null;
  async function getDeployment({rpc,fetcher,force=false}){
    if(!force&&configCache&&Date.now()-configAt<15000)return activeDeployment(configCache);
    if(inflight)return inflight;
    inflight=(async()=>{
      const r=await fetcher('/contracts/vote/deployment.json',{cache:'no-store'});if(!r.ok)throw Error('Voting deployment unavailable');
      const config=await r.json(),d=activeDeployment(config);
      if(d&&(await rpc('eth_getCode',[d.address,'latest']))?.toLowerCase()!==build.runtimeBytecode)throw Error('Voting bytecode mismatch');
      configCache=config;configAt=Date.now();return d;
    })().finally(()=>{inflight=null;});return inflight;
  }
  function createReader(){
    let reader=null,address=null;
    return async function readNativeVotes({rpc,fetcher}){
      const d=await getDeployment({rpc,fetcher});if(!d)return {rows:[],truncated:false};
      if(!reader||address!==d.address){
        address=d.address;
        reader=legacy.createReader({address:d.address,startBlock:d.block,topics:[build.eventTopic],
          historyUrl:'https://robinhoodchain.blockscout.com/api/v2/addresses/'+d.address+'/transactions?filter=to',
          candidate:item=>parseVoteInput(item.raw_input||item.input)?item.hash:null,
          eligibleLog:()=>true,verify:(tx,receipt)=>verifyVote(d,tx,receipt)});
      }
      return reader({rpc,fetcher});
    };
  }
  root.RWIBallot=Object.freeze({build,activeDeployment,encodeChoice,makeVote,parseVoteInput,verifyVote,getDeployment,createReader});
})(globalThis);
