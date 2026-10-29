import { safeTokenLogo } from './wallet-tokens.js';
export function ipfsPath(value){
  if(typeof value!=='string')return '';
  let path=value.trim();
  if(path.startsWith('ipfs://'))path=path.slice(7).replace(/^ipfs\//,'');
  else{try{const url=new URL(path),match=url.pathname.match(/^\/ipfs\/(.+)$/);if(!match)return '';path=match[1];}catch{return '';}}
  if(!/^[a-zA-Z0-9]{32,120}(?:\/[a-zA-Z0-9_.~-]+)*$/.test(path)||path.split('/').some(p=>p==='.'||p==='..'))return '';
  return path;
}
export function logoUrls(value){
  const cid=ipfsPath(value);
  if(cid)return ['https://gateway.pinata.cloud/ipfs/','https://ipfs.io/ipfs/'].map(base=>base+cid);
  const url=safeTokenLogo(value);return url?[url]:[];
}
export function sharperLogo(value){
  const safe=safeTokenLogo(value);if(!safe)return '';
  const url=new URL(safe);
  if(url.hostname==='dd.dexscreener.com'&&url.pathname.startsWith('/ds-data/tokens/'))url.searchParams.set('size','xl');
  if(['coin-images.coingecko.com','assets.coingecko.com'].includes(url.hostname))url.pathname=url.pathname.replace(/\/(?:thumb|small)\//,'/large/');
  if(url.hostname==='cdn.dexscreener.com'&&url.pathname.startsWith('/cms/images/')){
    for(const dimension of ['width','height'])url.searchParams.set(dimension,String(Math.max(256,Number(url.searchParams.get(dimension))||0)));
    url.searchParams.set('quality','100');
  }
  return url.href;
}
export function tokenLogoCandidates(token){
  const address=String(token.address||'').toLowerCase();
  if(address==='0xda2598c976e62e7e15dcca75169b404712e48b04')return ['/assets/rwi-logo.webp'];
  if(address==='0x0bd7d308f8e1639fab988df18a8011f41eacad73')return ['/assets/weth-logo.png'];
  const urls=[...(token.logos||[]).flatMap(logoUrls),...logoUrls(token.logo)];
  if(/^0x[0-9a-f]{40}$/.test(address))urls.push('https://dd.dexscreener.com/ds-data/tokens/robinhood/'+address+'.png','https://cdn.robinhood.com/ncw_assets/logos/'+address+'.png');
  return [...new Set(urls.flatMap(url=>[sharperLogo(url),url]).filter(Boolean))];
}
export function decodeAbiString(data,word=0){
  if(typeof data!=='string'||!/^0x(?:[0-9a-fA-F]{2})+$/.test(data)||data.length>262146)return '';
  const hex=data.slice(2),head=hex.slice(word*64,word*64+64);if(head.length!==64)return '';
  const offset=BigInt('0x'+head);if(offset>BigInt(hex.length/2)||offset%32n!==0n)return '';
  const start=Number(offset)*2,lengthWord=hex.slice(start,start+64);if(lengthWord.length!==64)return '';
  const length=BigInt('0x'+lengthWord);if(length>65536n||BigInt(start+64)+length*2n>BigInt(hex.length))return '';
  const bytes=Uint8Array.from(hex.slice(start+64,start+64+Number(length)*2).match(/../g)||[],b=>parseInt(b,16));
  try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return '';}
}
export function registryLogo(body,address){
  return (body?.assets||[]).find(a=>a.deployments?.some(d=>Number(d.chainId)===4663&&String(d.contractAddress).toLowerCase()===address.toLowerCase()))?.logoUrl||'';
}
