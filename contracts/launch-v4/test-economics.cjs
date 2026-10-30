const assert=require('assert/strict'),fs=require('fs'),path=require('path'),M=require('./economics-model.cjs');
const {W,S,terms,fee,output,fdv,eligible,buy}=M;
let rng=0x431da32an;const random=max=>{rng=(rng*6364136223846793005n+1442695040888963407n)&((1n<<64n)-1n);return rng%max};
let tradeChecks=0,finalFillChecks=0;
const scenarios=[];
for(const price of [10n**9n,10n**10n,10n**12n,27281636050000n,10n**15n,W,100n*W,1000000n*W]){
 const {phantom:p,inventory:initial}=terms(price);
 assert(fdv(p,0n,initial,price)>=5000n*W);assert(fdv(p,0n,initial,price)-5000n*W<10n**14n);
 for(const multiplier of [1n,10n,50n,100n,200n,1000n,10000n])for(const tax of [0,100,200,300]){
  const usd=price*multiplier/100n;if(usd<10n**9n||usd>1000000n*W)continue;
  const b=buy(p,0n,initial,tax,10n**37n,usd);const t=initial-b.out,q=b.net;
  assert(eligible(p,q,t,usd));const less=b.spent-1n,n=less-fee(less,tax),o=output(n,p,initial);assert(!eligible(p,n,initial-o,usd));
  assert((p+q)*t>=p*initial);assert(q*initial/(initial-t)>=p);assert(q*usd/W>=M.SEED);
  // Independent continuous solution must agree within negligible integer rounding.
  const pp=Number(p),ii=Number(initial),u=Number(usd),qAnalytic=Math.max(Number(M.SEED)*1e18/u,Math.sqrt(Number(M.TARGET)*1e18*pp*ii/(1e27*u))-pp);
  assert(Math.abs(Number(q)-qAnalytic)/Math.max(qAnalytic,1)<1e-10);
  const seed=t*q/(p+q),fullSellRwi=output(b.out,seed,q),postPrice=(q-fullSellRwi)*S/(seed+b.out)*usd/W;
  scenarios.push({launchRwiUsd:Number(price)/1e18,subsequentPriceMultiple:Number(multiplier)/100,taxBps:tax,requiredNetRwi:Number(q)/1e18,fdvUsd:Number(fdv(p,q,t,usd))/1e18,poolUsd:2*Number(q*usd/W)/1e18,soldPercent:Number(b.out)*100/Number(S),pooledPercent:Number(seed)*100/Number(S),lockedPercent:100-Number(b.out+seed)*100/Number(S),postGraduationFdvIfAllBuyersSellNoFees:Number(postPrice)/1e18,requiresMoreThanReferenceRwiTotalSupply:q>999925641741752859464605861n});finalFillChecks++;
 }
 for(const tax of [0,100,200,300]){
  let q=0n,t=initial,rewards=0n,cash=0n,totalBuy=0n,totalSell=0n,previousProduct=p*initial;
  // Tiny individual trades keep this accounting test below graduation without assuming any price growth.
  for(let i=0;i<2500;i++){
   const sold=initial-t;
   if(sold>0n&&random(2n)===0n){
    const input=1n+random(sold),gross=output(input,t,p+q);if(!gross)continue;assert(gross<=q);const charge=fee(gross,tax);q-=gross;t+=input;rewards+=charge;cash-=gross-charge;totalSell+=gross-charge;
   }else{
    const input=1n+random(p/1000000n+1n),charge=fee(input,tax),net=input-charge,out=output(net,p+q,t);if(!out)continue;q+=net;t-=out;rewards+=charge;cash+=input;totalBuy+=input;
   }
   assert(t>0n&&t<=initial);assert(q>=0n);assert.equal(q+rewards,cash);assert(totalSell<=totalBuy);assert((p+q)*t>=previousProduct);previousProduct=(p+q)*t;tradeChecks++;
  }
  const gross=output(initial-t,t,p+q);assert(gross<=q);q-=gross;t=initial;assert(q<1000000000n);assert.equal(t,initial);
 }
}
let feeBoundaryChecks=0;
for(const tax of [0,100,200,300]){
 let previous=0n;
 for(let gross=1n;gross<=10000n;gross++){const net=gross-fee(gross,tax);assert(net>=previous);previous=net;feeBoundaryChecks++}
 for(let gap=1n;gap<=400n;gap++){
  const p=W,q=M.SEED-gap,t=10n**24n,usd=W;let brute=1n;
  while(brute-fee(brute,tax)<gap)brute++;
  const b=buy(p,q,t,tax,10000n,usd);assert.equal(b.spent,brute);feeBoundaryChecks++;
 }
}
const ref=scenarios.filter(s=>s.launchRwiUsd===0.00002728163605&&s.taxBps===0);
const report={testedAt:new Date().toISOString(),deterministicSeed:'0x431da32a',randomTradeChecks:tradeChecks,feeBoundaryChecks,minimalFinalFillCases:finalFillChecks,referenceScenarios:ref,coverage:'8 launch prices; 0.01x through 100x subsequent RWI movement; all four creator fee settings; integer dust; reserve/fee segregation; no redemption of phantom reserves; product monotonicity',limitations:'Algebraic scenarios treat RWI moves as exogenous. They are not predictions and do not measure oracle integrity, availability, executable route depth, gas, or MEV.',scenarios};
fs.mkdirSync(path.join(__dirname,'artifacts'),{recursive:true});fs.writeFileSync(path.join(__dirname,'artifacts/economic-validation.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,scenarios:undefined},null,2));
