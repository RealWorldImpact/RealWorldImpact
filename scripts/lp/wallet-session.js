const KEY='rwi-lp-wallet-connector';
export function saveConnector(storage,candidate){
  if(!candidate)return;
  try{storage.setItem(KEY,JSON.stringify({name:String(candidate.name||'Browser wallet').slice(0,100),rdns:String(candidate.rdns||'').slice(0,200)}));}catch{}
}
export function forgetConnector(storage){try{storage.removeItem(KEY);}catch{}}
export function savedConnector(storage,candidates){
  try{
    const saved=JSON.parse(storage.getItem(KEY));if(!saved||typeof saved.name!=='string')return null;
    const matches=candidates.filter(c=>saved.rdns?c.rdns===saved.rdns:c.name===saved.name);
    return matches.length===1?matches[0]:null;
  }catch{return null;}
}
