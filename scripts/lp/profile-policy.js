import { getAddress } from 'ethers';
import { IMAGE_STORE_ORIGIN } from './launch-image-policy.js';
export const PROFILE_API='/api/lp-upload-image?kind=profile';
export function profileWallet(value){try{const a=getAddress(value);if(/^0x0{40}$/i.test(a))throw Error();return a.toLowerCase();}catch{throw Error('Enter a valid wallet address.');}}
export function profileFields(value){
  const displayName=typeof value?.displayName==='string'?value.displayName.trim():null,bio=typeof value?.bio==='string'?value.bio.trim():null;
  if(displayName===null||bio===null||[...displayName].length>32||[...bio].length>160||/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(displayName)||/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(bio))throw Error('Use a name up to 32 characters and a single-line bio up to 160 characters.');
  return {displayName,bio};
}
export function profileImageUrl(value,address){
  try{const u=new URL(value),wallet=profileWallet(address);return u.origin===IMAGE_STORE_ORIGIN&&!u.username&&!u.password&&!u.search&&!u.hash&&new RegExp('^/profile-images/v1/'+wallet+'/[0-9a-f]{64}\\.png$').test(u.pathname)?u.href:'';}catch{return '';}
}
export function profileUpdateMessage(input){
  const address=profileWallet(input.address),{displayName,bio}=profileFields(input);
  if(!/^(0|[0-9a-f]{32})$/.test(input.revision)||!['keep','upload','remove'].includes(input.imageAction)||!Number.isSafeInteger(input.issuedAt)||input.issuedAt<=0||input.imageAction==='upload'&&!/^0x[0-9a-f]{64}$/.test(input.sha256)||input.imageAction!=='upload'&&input.sha256!=='')throw Error('Invalid profile update. Reopen the editor and try again.');
  return ['RWI LP public profile update','Website: https://www.rwihood.org','Network: Robinhood Chain (4663)','Wallet: '+address,'Current revision: '+input.revision,'Display name (JSON): '+JSON.stringify(displayName),'Bio (JSON): '+JSON.stringify(bio),'Image action: '+input.imageAction,'Image SHA-256: '+input.sha256,'Issued at: '+input.issuedAt,'Publish these details on my public RWI profile.','This signature cannot transfer tokens or authorize a transaction.'].join('\n');
}
export function readPublicProfile(value,address){
  const wallet=profileWallet(address),fields=profileFields(value);
  if(value?.address!==wallet||!/^(0|[0-9a-f]{32})$/.test(value.revision)||value.avatar!==''&&!profileImageUrl(value.avatar,wallet)||!Number.isSafeInteger(value.updatedAt)||value.updatedAt<0)throw Error('The public profile could not be read.');
  return {address:wallet,...fields,avatar:value.avatar,revision:value.revision,updatedAt:value.updatedAt};
}
