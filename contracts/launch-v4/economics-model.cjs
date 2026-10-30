// Independent integer model and reproducible economic scenarios. No network calls.
const W=10n**18n,S=10n**27n,START=5000n*W,TARGET=50000n*W,POOL=5000n*W,SEED=250001n*10n**16n;
const ceil=(a,b)=>(a+b-1n)/b;
function sqrt(n){if(n<2n)return n;let a=n,b=(a+1n)/2n;while(b<a){a=b;b=(a+n/a)/2n}return a}
function terms(price){if(price<10n**9n||price>1000000n*W)throw Error('Unsupported price');const virtualUsd=SEED*W/(sqrt(10n*W*W)-W),inventory=virtualUsd*S/START,phantom=ceil(ceil(START*W,price)*inventory,S);return {phantom,inventory}}
const fee=(amount,tax)=>amount*(100n+BigInt(tax))/10000n;
const output=(input,rin,rout)=>input*rout/(rin+input);
const fdv=(p,q,t,usd)=>(p+q)*S/t*usd/W;
const eligible=(p,q,t,usd)=>q*usd/W>=SEED&&fdv(p,q,t,usd)>=TARGET;
function buy(p,q,t,tax,gross,usd){let spent=gross;const evaluate=a=>{const net=a-fee(a,tax),out=output(net,p+q,t);return {net,out,ready:eligible(p,q+net,t-out,usd)}};let result=evaluate(spent);if(result.ready){let lo=0n,hi=gross;while(hi-lo>1n){let mid=(lo+hi)/2n;if(evaluate(mid).ready)hi=mid;else lo=mid}spent=hi;result=evaluate(spent)}if(!result.out||result.out>=t)throw Error('Dust');return {out:result.out,spent,net:result.net}}
module.exports={W,S,START,TARGET,POOL,SEED,ceil,sqrt,terms,fee,output,fdv,eligible,buy};
