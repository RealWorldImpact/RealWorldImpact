// Economic requirement audit, not a deployment acceptance test.
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),esbuild=require('../../scripts/lp/node_modules/esbuild');
const dir=path.join(__dirname,'artifacts');fs.mkdirSync(dir,{recursive:true});
esbuild.buildSync({entryPoints:[path.join(__dirname,'../../scripts/lp/launch-v3-model.js')],outfile:path.join(dir,'audit-model.cjs'),bundle:true,platform:'node',format:'cjs'});
const M=require('./artifacts/audit-model.cjs'),supply=999925641741752859464605861n,referencePrice='0.00002728163605',terms=M.launchTerms(referencePrice,supply);
const P=Number(terms.phantomQuote)/1e18,cap=Number(terms.rwiReserveCap)/1e18;
const scenarios=[0.01,0.1,0.5,1,2,5,10,100].map(multiplier=>{
 const requiredNetRwi=P*Math.max(0,Math.sqrt(10/multiplier)-1);
 const usdAtFixedGraduation=50000*multiplier;
 const reserveUsd=requiredNetRwi*Number(referencePrice)*multiplier;
 const quote={rwiPriceMultiplier:multiplier,preparedV3GraduationFdvUsd:usdAtFixedGraduation,netRwiForLive50kWithSameCurve:requiredNetRwi,exceedsPreparedReserveCap:requiredNetRwi>cap+0.000001,zeroBuyersCanMeetPriceTarget:multiplier>=10,indicativePoolUsdAtLiveTarget:2*reserveUsd};
 assert(Math.abs(5000*multiplier*(1+requiredNetRwi/P)**2-Math.max(50000,5000*multiplier))<0.001);
 return quote;
});
assert.equal(scenarios.find(x=>x.rwiPriceMultiplier===10).preparedV3GraduationFdvUsd,500000);
assert(scenarios.find(x=>x.rwiPriceMultiplier===0.5).exceedsPreparedReserveCap);
assert.equal(scenarios.find(x=>x.rwiPriceMultiplier===10).indicativePoolUsdAtLiveTarget,0);
const newLaunches=[0.1,1,10,100,1000].map(multiplier=>{const t=M.launchTerms((Number(referencePrice)*multiplier).toFixed(18),supply);return {rwiPriceMultiplier:multiplier,netRwi:Number(t.graduationQuote)/1e18,netReserveUsd:Number(t.netReserveUsd),poolUsd:Number(t.poolLiquidityUsd),soldPercent:Number(t.soldPercent),lockedPercent:Number(t.lockedPercent)};});
const churn=[];
for(const tax of [0n,100n,200n,300n]){
 let q=0n,t=BigInt(terms.initialTokens),fees=0n,creatorFees=0n,volume=0n;const p=BigInt(terms.phantomQuote),fee=a=>a/100n+a*tax/10000n;
 for(let i=0;i<1000;i++){
  const gross=BigInt(1+i%100)*10n**18n,charge=fee(gross),net=gross-charge,out=net*t/(p+q+net);q+=net;t-=out;fees+=charge;creatorFees+=gross*tax/10000n;volume+=gross;
  const redemption=out*(p+q)/(t+out);q-=redemption;t+=out;fees+=fee(redemption);creatorFees+=redemption*tax/10000n;volume+=redemption;
 }
 assert.equal(t,BigInt(terms.initialTokens));assert(q<10000n);assert(fees>0n);
 churn.push({additionalTaxBps:Number(tax),roundTrips:1000,grossRwiVolume:volume.toString(),netRwiReserve:q.toString(),totalFeesRwi:fees.toString(),creatorFeesRwi:creatorFees.toString(),graduates:false});
}
// Revised requirements selected by the user: BOTH live FDV >= $50k AND pool >= $5k.
// This is an analytical candidate, not executable contract logic or an oracle implementation.
const minPoolUsd=5000,netQuoteUsd=minPoolUsd/2,virtualQuoteUsd=netQuoteUsd/(Math.sqrt(10)-1),inventoryFraction=virtualQuoteUsd/5000;
const revisedScenarios=[0.01,0.1,0.5,1,2,5,10,100].map(multiplier=>{
 const usd=Number(referencePrice)*multiplier,p=virtualQuoteUsd/Number(referencePrice);
 const qForPrice=p*Math.max(0,Math.sqrt(10/multiplier)-1),qForLiquidity=netQuoteUsd/usd,q=Math.max(qForPrice,qForLiquidity);
 const fdv=5000*multiplier*(1+q/p)**2,pool=2*q*usd;
 assert(fdv>=50000-0.00001);assert(pool>=minPoolUsd-0.00001);
 const less=q*(1-0.000001);assert(5000*multiplier*(1+less/p)**2<50000||2*less*usd<minPoolUsd);
 return {rwiPriceMultiplier:multiplier,minimumRwiFromLiquidityAlone:qForLiquidity,netRwiAtBothConditions:q,graduationFdvUsd:fdv,poolUsd:pool,limitingCondition:qForPrice>qForLiquidity?'price':'liquidity'};
});
const report={checkedAt:new Date().toISOString(),deploymentSuitable:false,reason:'Fixed RWI graduation fails the live USD requirement.',referencePrice,capRwi:cap,scenarioMethod:'Independent constant-product algebra, ignoring sub-wei rounding and fees; after-launch price changes are exogenous scenarios, not predictions.',scenarios,newLaunches,churn,currentDistribution:{soldPercent:terms.soldPercent,poolPercent:terms.poolPercent,lockedPercent:terms.lockedPercent,nonPermanentlyLockedValueAt50k:(1-Number(terms.lockedPercent)/100)*50000},revisedRequirements:{startingFdvUsd:5000,graduationFdvUsd:50000,minimumPoolUsd:minPoolUsd,minimumQuoteUsd:netQuoteUsd,liveUsdOracleRequired:true,oracleNotImplemented:true},candidateUnchangedPriceAllocation:{initialInventoryPercent:inventoryFraction*100,soldPercent:inventoryFraction*(1-1/Math.sqrt(10))*100,poolPercent:netQuoteUsd/50000*100,lockedPercent:(1-inventoryFraction*(1-1/Math.sqrt(10))-netQuoteUsd/50000)*100},revisedScenarios};
fs.writeFileSync(path.join(dir,'market-scenario-audit.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({deploymentSuitable:false,scenarios,newLaunches,churnCases:churn.length,checks:'Expected economic mismatches reproduced; 4,000 buy/sell round trips conserve reserve accounting.'},null,2));
