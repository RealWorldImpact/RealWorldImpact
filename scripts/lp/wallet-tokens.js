const RWI='0xda2598c976e62e7e15dcca75169b404712e48b04';
const ZERO='0x0000000000000000000000000000000000000000';
const ADDRESS=/^0x[0-9a-fA-F]{40}$/;
const SCALE=10n**36n;
export function safeTokenLogo(value){
  if(typeof value!=='string'||value.length>2048)return '';
  let source=value.trim();if(source.startsWith('ipfs://'))source='https://ipfs.io/ipfs/'+source.slice(7).replace(/^ipfs\//,'');
  try{const url=new URL(source);return url.protocol==='https:'&&!url.username&&!url.password?url.href:'';}catch{return '';}
}
export function normalizePortfolio(body){
  if(!body||!Array.isArray(body.positions))throw Error('Invalid wallet portfolio response.');
  const tokens=new Map();
  for(const p of body.positions){
    if(!p||typeof p!=='object')continue;
    const address=String(p.token||'').toLowerCase(),decimals=Number(p.decimals);
    if(!ADDRESS.test(address)||address===ZERO||address===RWI||!Number.isInteger(decimals)||decimals<0||decimals>36)continue;
    const mark=p.prices?.now,raw=mark?.usd;
    const price=typeof raw==='string'||typeof raw==='number'?String(raw):null;
    tokens.set(address,{address,decimals,symbol:String(p.symbol||'TOKEN').slice(0,24),name:String(p.name||p.symbol||'Token').slice(0,80),logo:safeTokenLogo(p.logo),priceUsd:price&&/^\d{1,60}(?:\.\d{1,60})?$/.test(price)&&!(Number(mark?.age_days)>1)?price:null});
  }
  return {tokens:[...tokens.values()].slice(0,200),partial:body.truncated===true||tokens.size>200};
}
export function holdingValue(balance,decimals,price){
  if(price===null||price===undefined)return null;
  const s=String(price);if(!/^\d{1,60}(?:\.\d{1,60})?$/.test(s))return null;
  const [whole,fraction='']=s.split('.');
  const scaled=BigInt(whole)*SCALE+BigInt((fraction+'0'.repeat(36)).slice(0,36));
  return BigInt(balance)*scaled/(10n**BigInt(decimals));
}
export function sortHoldings(rows){
  return rows.filter(x=>BigInt(x.balance)>0n).map(x=>({...x,valueUsd:holdingValue(x.balance,x.decimals,x.priceUsd)})).sort((a,b)=>{
    if(a.valueUsd===null&&b.valueUsd!==null)return 1;
    if(b.valueUsd===null&&a.valueUsd!==null)return -1;
    if(a.valueUsd!==b.valueUsd)return a.valueUsd>b.valueUsd?-1:1;
    return a.symbol.localeCompare(b.symbol)||a.address.localeCompare(b.address);
  });
}
export function usdLabel(value){
  if(value===null)return 'USD unavailable';
  if(value>0n&&value<SCALE/100n)return '<$0.01';
  return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(Number(value)/Number(SCALE));
}
