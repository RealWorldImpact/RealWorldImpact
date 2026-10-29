import { decodeAbiString, logoUrls, ipfsPath, registryLogo } from '../scripts/lp/token-logos.js';
let registry=null,registryAt=0,registryPending=null;
const cache=new Map();
async function json(url,options={}){
  const res=await fetch(url,{...options,signal:AbortSignal.timeout(3500)});if(!res.ok)throw Error('Metadata unavailable');
  const reader=res.body?.getReader();if(!reader)return res.json();
  const chunks=[];let size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2_000_000){await reader.cancel();throw Error('Metadata too large');}chunks.push(value);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function official(address){
  if(!registry||Date.now()-registryAt>3600000){
    if(!registryPending)registryPending=json('https://api.robinhood.com/rhj/assets').then(body=>{registry=body;registryAt=Date.now();}).finally(()=>{registryPending=null;});
    await registryPending;
  }
  return logoUrls(registryLogo(registry,address));
}
async function market(address){
  const body=await json('https://api.geckoterminal.com/api/v2/networks/robinhood/tokens/'+address);
  if(body.data?.attributes?.address?.toLowerCase()!==address)return [];
  return logoUrls(body.data.attributes.image_url);
}
async function onchain(address){
  const selectors=['0xfb7f21eb','0xabb1dc44','0x3c130d90']; // logo(), getTokenInfo(), tokenURI()
  const body=await json('https://rpc.mainnet.chain.robinhood.com',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(selectors.map((data,id)=>({jsonrpc:'2.0',id,method:'eth_call',params:[{to:address,data},'latest']})))});
  if(!Array.isArray(body))return [];
  const result=id=>body.find(r=>r.id===id)?.result;
  const logos=[...logoUrls(decodeAbiString(result(0))),...logoUrls(decodeAbiString(result(1),1))];
  const uri=decodeAbiString(result(2)),cid=ipfsPath(uri);
  if(cid){
    try{const metadata=await json('https://gateway.pinata.cloud/ipfs/'+cid);logos.push(...logoUrls(metadata.image||metadata.image_url||metadata.logo));}catch{}
  }else if(uri.startsWith('data:application/json;base64,')){
    try{const metadata=JSON.parse(Buffer.from(uri.split(',')[1],'base64').toString('utf8'));logos.push(...logoUrls(metadata.image||metadata.image_url||metadata.logo));}catch{}
  }
  return logos;
}
export default async function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  const address=typeof req.query.address==='string'?req.query.address.toLowerCase():'';
  if(!/^0x[0-9a-f]{40}$/.test(address))return res.status(400).json({error:'Invalid token address'});
  const saved=cache.get(address);if(saved&&Date.now()-saved.at<3600000){res.setHeader('Cache-Control','public, s-maxage=600');return res.status(200).json(saved.body);}
  const sources=await Promise.allSettled([official(address),onchain(address),market(address)]);
  const logos=[...new Set(sources.flatMap(r=>r.status==='fulfilled'?r.value:[]))];
  const body={address,logos};
  // Empty results are not cached: an upstream outage must not hide a newly available logo.
  if(logos.length){if(cache.size>=500)cache.delete(cache.keys().next().value);cache.set(address,{at:Date.now(),body});res.setHeader('Cache-Control','public, s-maxage=600');}
  else res.setHeader('Cache-Control','no-store');
  return res.status(200).json(body);
}
