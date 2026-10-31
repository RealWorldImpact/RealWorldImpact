const assert=require('assert/strict'),fs=require('fs'),path=require('path'),M=require('./economics-model.cjs');
const {W,S,terms,fee,output,buy}=M;
let rng=0x5a110ca7n,checks=0,finalChecks=0;const random=max=>{rng=(rng*6364136223846793005n+1442695040888963407n)&((1n<<64n)-1n);return rng%max;};
const scenarios=[];
for(const price of [10n**9n,10n**12n,28202504875523n,10n**15n,W,1000000n*W])for(const tax of [0,100,200,300]){
 const {phantom:p,inventory:i,reserved:f,referenceQuote}=terms(price);
 let q=0n,t=i,cash=0n,rewards=0n,k=p*i;
 for(let x=0;x<1500;x++){
  const sold=i-t;
  if(sold>0n&&random(2n)===0n){
   const amount=1n+random(sold),gross=output(amount,t,p+q);if(!gross)continue;
   assert(gross<=q);const charge=fee(gross,tax);t+=amount;q-=gross;cash-=gross-charge;rewards+=charge;
  }else{
   const gross=1n+random(p/1000000n+1n);let b;try{b=buy(p,q,t,f,tax,gross)}catch(e){assert.match(e.message,/Dust/);continue;}
   q+=b.net;t-=b.out;cash+=b.spent;rewards+=fee(b.spent,tax);
  }
  assert.equal(q+rewards,cash);assert(t>=f&&t<=i);assert((p+q)*t>=k);k=(p+q)*t;checks++;
 }
 const before={q,t};const last=buy(p,q,t,f,tax,10n**38n);
 assert.equal(t-last.out,f);assert(last.spent<10n**38n);assert(last.spent>0n);
 const lower=last.spent-1n;assert(output(lower-fee(lower,tax),p+q,t)<t-f,'Final fill must be minimal');
 q+=last.net;t=f;assert(q>=referenceQuote);assert.equal(t-f,0n);assert.throws(()=>buy(p,q,t,f,tax,W));finalChecks++;
 const seed=t*q/(p+q),fdv=(p+q)*S/t*price/W;
 assert(seed>0n&&seed<t);assert(q*price/W>=M.SEED);
 assert(Math.abs(Number(fdv)/Number(M.TARGET)-1)<1e-8,'Reference valuation at sellout');
 // Price changes do not alter the token allocation or graduation condition.
 if(price===28202504875523n&&tax===0)for(const ratio of [1n,10n,50n,100n,200n,1000n])scenarios.push({rwiPriceMultiple:Number(ratio)/100,openingRwiUsd:Number(price)/1e18,netRwi:Number(q)/1e18,graduationFdvUsd:Number(fdv*ratio/100n)/1e18,poolUsd:Number(2n*q*price/W*ratio/100n)/1e18,soldPercent:Number(i-t)*100/Number(S),pooledPercent:Number(seed)*100/Number(S),condition:'Sellable allocation exhausted; not a live USD threshold'});
 // A failed graduation may permit a sell and reopen the same curve without touching fees.
 const amount=(i-f)/1000n,gross=output(amount,t,p+q);assert(gross<=q);q-=gross;t+=amount;assert(t>f);assert(buy(p,q,t,f,tax,last.spent).out===amount);
 assert(before.t>f);
}
const report={testedAt:new Date().toISOString(),randomAccountingChecks:checks,minimalFinalFillCases:finalChecks,referenceScenarios:scenarios,limitations:'Model only; contract, routing and graduation integration still require fork tests. USD targets are creation-time estimates.'};
fs.mkdirSync(path.join(__dirname,'artifacts'),{recursive:true});fs.writeFileSync(path.join(__dirname,'artifacts/economics.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
