const W=10n**18n,S=10n**27n,START=5000n*W,TARGET=40000n*W,SEED=250001n*10n**16n;
const ceil=(a,b)=>(a+b-1n)/b;
function sqrt(n){if(n<2n)return n;let a=n,b=(a+1n)/2n;while(b<a){a=b;b=(a+n/a)/2n}return a;}
function terms(price){
 if(price<10n**9n||price>1000000n*W)throw Error('Unsupported opening reference');
 const virtualUsd=SEED*W/(sqrt(TARGET*W*W/START)-W),inventory=virtualUsd*S/START;
 const phantom=ceil(ceil(START*W,price)*inventory,S),referenceQuote=ceil(SEED*W,price),reserved=inventory*phantom/(phantom+referenceQuote);
 if(reserved===0n||reserved>=inventory)throw Error('Invalid allocation');return {phantom,inventory,reserved,referenceQuote};
}
const fee=(amount,tax)=>amount*(100n+BigInt(tax))/10000n;
const output=(input,reserveIn,reserveOut)=>input*reserveOut/(reserveIn+input);
function buy(p,q,t,reserved,tax,gross){
 if(gross<=0n||t<=reserved)throw Error('Closed or empty');let spent=gross,out=output(gross-fee(gross,tax),p+q,t),available=t-reserved;
 if(out>=available){let lo=0n,hi=gross;while(hi-lo>1n){const mid=(lo+hi)/2n;if(output(mid-fee(mid,tax),p+q,t)>=available)hi=mid;else lo=mid;}spent=hi;out=available;}
 if(!out)throw Error('Dust');return {spent,out,net:spent-fee(spent,tax)};
}
module.exports={W,S,START,TARGET,SEED,ceil,sqrt,terms,fee,output,buy};
