// Shared browser/server limits. Uploaded originals are never stored.
export const IMAGE_MAX_BYTES=3*1024*1024;
export const IMAGE_MAX_PIXELS=16_777_216;
export const IMAGE_MIN_SIDE=128;
export const IMAGE_STORE_ORIGIN='https://mz5k7vjujuasnod9.public.blob.vercel-storage.com';
export function imageKind(bytes){
  if(bytes.length>=24&&[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v))return 'png';
  if(bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'jpeg';
  if(bytes.length>=16&&String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP')return 'webp';
  throw Error('Choose a PNG, JPG, or WebP image. SVG, GIF, and other files are not supported.');
}
export function checkImageDimensions(width,height){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<IMAGE_MIN_SIDE||height<IMAGE_MIN_SIDE)throw Error('Use an image at least 128 × 128 pixels. A 512 × 512 image works best.');
  if(width>8192||height>8192||width*height>IMAGE_MAX_PIXELS)throw Error('This image is too large. Use an image under 16 megapixels and 8192 pixels per side.');
}
export function checkStillImage(bytes){
  const kind=imageKind(bytes),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(kind==='png')for(let offset=8;offset+12<=bytes.length;){
    const size=view.getUint32(offset),tag=String.fromCharCode(...bytes.slice(offset+4,offset+8));
    if(tag==='acTL')throw Error('Choose a still image instead of an animation.');
    if(size>bytes.length-offset-12)throw Error('The image is incomplete or damaged.');offset+=size+12;
  }
  if(kind==='webp')for(let offset=12;offset+8<=bytes.length;){
    const size=view.getUint32(offset+4,true),tag=String.fromCharCode(...bytes.slice(offset,offset+4));
    if(tag==='ANIM'||tag==='ANMF'||(tag==='VP8X'&&size>0&&(bytes[offset+8]&2)))throw Error('Choose a still image instead of an animation.');
    if(size>bytes.length-offset-8)throw Error('The image is incomplete or damaged.');offset+=8+size+(size%2);
  }
}
export function imageUploadMessage(address,digest,issuedAt){
  if(!/^0x[0-9a-fA-F]{40}$/.test(address)||!/^0x[0-9a-f]{64}$/.test(digest)||!Number.isSafeInteger(issuedAt))throw Error('Invalid image upload request.');
  return ['RWI LP token image upload','Website: https://www.rwihood.org','Network: Robinhood Chain (4663)','Wallet: '+address.toLowerCase(),'Image SHA-256: '+digest,'Issued at: '+issuedAt,'Publish this image as a public token logo.','This signature cannot transfer tokens or authorize a transaction.'].join('\n');
}
export function uploadedImageUrl(value){
  try{const u=new URL(value);return u.origin===IMAGE_STORE_ORIGIN&&!u.username&&!u.password&&!u.search&&!u.hash&&/^\/launch-images\/v1\/0x[0-9a-f]{40}\/\d{4}-\d{2}-\d{2}\/[0-9a-f]{64}\.png$/.test(u.pathname)?u.href:'';}catch{return '';}
}
