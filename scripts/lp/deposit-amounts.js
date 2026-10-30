export function percentageAmount(balance,percent){
  if(!Number.isInteger(percent)||percent<0||percent>100)throw Error('Choose 0% to 100%.');
  const held=BigInt(balance);if(held<0n)throw Error('Invalid wallet balance.');
  return held*BigInt(percent)/100n;
}
