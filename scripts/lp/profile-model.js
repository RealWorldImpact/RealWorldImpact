import { getAddress } from 'ethers';

export function profileAddress(value){
  if(typeof value!=='string'||!/^0x[0-9a-fA-F]{40}$/.test(value))return null;
  try{return getAddress(value);}catch{return null;}
}
export function ownsProfile(subject,account){return Boolean(subject&&account&&subject.toLowerCase()===account.toLowerCase());}
export function profileLink(address,origin){
  const who=profileAddress(address);if(!who)throw Error('Enter a valid wallet address.');
  return new URL('/LP?profile='+who,origin).href;
}
export function sumKnown(values){
  return {value:values.reduce((sum,v)=>sum+(v??0n),0n),partial:values.some(v=>v===null)};
}
export function creatorLaunches(rows,creator){
  const address=profileAddress(creator);if(!address)return [];
  return [...new Map(rows.filter(t=>t&&profileAddress(t.address)&&ownsProfile(t.creator,address)&&typeof t.name==='string'&&typeof t.symbol==='string'&&typeof t.description==='string'&&[0,100,200,300].includes(t.creatorTaxBps)&&[0,1,2].includes(t.phase)&&/^\d{1,78}$/.test(t.rewardRwi)&&/^\d{1,78}$/.test(t.phantomQuote)&&BigInt(t.phantomQuote)>0n&&/^\d{1,78}$/.test(t.quoteReserve)&&Number.isFinite(t.launchedAt)).map(t=>[t.address.toLowerCase(),t])).values()].sort((a,b)=>b.launchedAt-a.launchedAt||a.address.localeCompare(b.address));
}
