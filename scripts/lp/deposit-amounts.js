export function percentageAmount(balance,percent){
  if(!Number.isInteger(percent)||percent<0||percent>100)throw Error('Choose 0% to 100%.');
  const held=BigInt(balance);if(held<0n)throw Error('Invalid wallet balance.');
  return held*BigInt(percent)/100n;
}
import { holdingValue } from './wallet-tokens.js';
export function matchDollarAmounts(source,target,percent){
  const text=String(percent);if(!/^\d{1,3}(?:\.\d{1,2})?$/.test(text)||Number(percent)>100)throw Error('Choose 0% to 100%.');
  const [whole,fraction='']=text.split('.'),bps=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
  const sourceUnit=holdingValue(10n**BigInt(source.decimals),source.decimals,source.priceUsd),targetUnit=holdingValue(10n**BigInt(target.decimals),target.decimals,target.priceUsd);
  if(!sourceUnit||!targetUnit||sourceUnit<0n||targetUnit<0n)return null;
  const sourceBalance=BigInt(source.balance),targetBalance=BigInt(target.balance);
  if(sourceBalance<0n||targetBalance<0n)throw Error('Invalid wallet balance.');
  const requestedAmount=sourceBalance*bps/10000n,requested=holdingValue(requestedAmount,source.decimals,source.priceUsd),available=holdingValue(targetBalance,target.decimals,target.priceUsd);
  const usd=requested<available?requested:available;
  const sourceAmount=requested<=available?requestedAmount:usd*10n**BigInt(source.decimals)/sourceUnit,targetAmount=usd===available?targetBalance:usd*10n**BigInt(target.decimals)/targetUnit;
  return {sourceAmount,targetAmount,capped:requested>available,sourcePercent:requested<=available?Number(percent):sourceBalance?Number(sourceAmount*10000n/sourceBalance)/100:0,targetPercent:targetBalance?Number(targetAmount*10000n/targetBalance)/100:0};
}
