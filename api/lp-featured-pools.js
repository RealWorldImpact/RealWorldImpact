import { rankFeaturedPools } from '../scripts/lp/featured-pools.js';
let saved=null,pending=null;
async function load(){
  const pages=[];let partial=false;
  for(let page=1;page<=5;page++){
    const response=await fetch('https://api.geckoterminal.com/api/v2/networks/robinhood/tokens/0xda2598c976e62e7e15dcca75169b404712e48b04/pools?include=base_token,quote_token,dex&page='+page,{signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw Error('Pool feed unavailable');
    const body=await response.json();if(!Array.isArray(body.data))throw Error('Invalid pool feed');pages.push(body);
    if(body.data.length<20)break;if(page===5)partial=true;
  }
  const body={pools:rankFeaturedPools(pages),partial,updatedAt:new Date().toISOString()};saved={at:Date.now(),body};return body;
}
export default async function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  try{
    if(!saved||Date.now()-saved.at>60000){if(!pending)pending=load().finally(()=>{pending=null;});await pending;}
    res.setHeader('Cache-Control','public, s-maxage=60');return res.status(200).json({...saved.body,stale:false});
  }catch{
    res.setHeader('Cache-Control','no-store');
    if(saved&&Date.now()-saved.at<300000)return res.status(200).json({...saved.body,stale:true});
    return res.status(502).json({error:'Featured pools are temporarily unavailable.'});
  }
}
