import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { verifyMessage, hashMessage, JsonRpcProvider, Contract, FetchRequest } from 'ethers';
import { IMAGE_MAX_BYTES, IMAGE_MAX_PIXELS, imageKind, checkImageDimensions, imageUploadMessage, uploadedImageUrl } from '../launch-image-policy.js';
const digest=bytes=>'0x'+createHash('sha256').update(bytes).digest('hex');
const error=(message,status=400)=>Object.assign(Error(message),{status});
export async function authorizeImage(address,message,signature){
  try{if(verifyMessage(message,signature).toLowerCase()===address)return true;}catch{}
  // Smart-contract wallets can use the standard EIP-1271 signature check.
  const connection=new FetchRequest('https://rpc.mainnet.chain.robinhood.com');connection.timeout=10000;
  const rpc=new JsonRpcProvider(connection,4663,{staticNetwork:true});
  try{if(await rpc.getCode(address)==='0x')return false;return (await new Contract(address,['function isValidSignature(bytes32,bytes) view returns(bytes4)'],rpc).isValidSignature(hashMessage(message),signature))==='0x1626ba7e';}catch{return false;}finally{rpc.destroy();}
}
export async function normalizeImage(bytes){
  let kind;try{kind=imageKind(bytes);}catch(e){throw error(e.message);}
  if(kind==='png'){
    for(let offset=8;offset+12<=bytes.length;){const length=bytes.readUInt32BE(offset);if(bytes.toString('ascii',offset+4,offset+8)==='acTL')throw error('Choose a still image instead of an animation.');if(length>bytes.length-offset-12)throw error('The image is incomplete or damaged.');offset+=length+12;}
  }
  try{
    const image=sharp(bytes,{limitInputPixels:IMAGE_MAX_PIXELS,failOn:'warning'}),metadata=await image.metadata();
    if(!['png','jpeg','webp'].includes(metadata.format)||metadata.format!==kind)throw error('The file contents do not match a supported image.');
    if(metadata.pages>1)throw error('Choose a still image instead of an animation.');
    checkImageDimensions(metadata.width,metadata.height);
    // Auto-orient, retain alpha and the full artwork, remove EXIF/location data,
    // and encode losslessly. No image is enlarged or stretched.
    const output=await image.rotate().resize({width:512,height:512,fit:'inside',withoutEnlargement:true}).png({compressionLevel:9}).toBuffer({resolveWithObject:true});
    if(output.data.length>IMAGE_MAX_BYTES)throw error('The optimized image is too large.');
    return {bytes:output.data,width:output.info.width,height:output.info.height};
  }catch(e){throw error(e.status?e.message:/at least|megapixels/.test(e.message)?e.message:'The image could not be read completely. Choose another file.');}
}
export function createImageUploadHandler({storage,authorize=authorizeImage,clock=Date.now,verifyPublic=async()=>{},allowedOrigins=['https://www.rwihood.org','https://rwihood.org']}={}){
  const rates=new Map(),saved=new Map();
  const rate=key=>{const now=clock(),entry=rates.get(key);if(entry&&now-entry.at<60000){if(entry.count++>=20)throw error('Too many upload attempts. Please wait a minute.',429);}else{if(rates.size>=1000)rates.delete(rates.keys().next().value);rates.set(key,{at:now,count:1});}};
  return async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
    try{
      const origin=req.headers?.origin;if(origin&&!allowedOrigins.includes(origin))throw error('Upload from the RWI LP page.',403);
      if(!String(req.headers?.['content-type']||'').startsWith('application/json'))throw error('Invalid upload format.',415);
      if(Number(req.headers?.['content-length'])>4_300_000)throw error('Choose an image smaller than 3 MB.',413);
      rate('ip:'+String(req.headers?.['x-forwarded-for']||'unknown').split(',')[0].slice(0,64));
      const body=typeof req.body==='string'?JSON.parse(req.body):req.body;
      const {address:raw,sha256,issuedAt,signature,image}=body||{},address=typeof raw==='string'?raw.toLowerCase():'';
      if(!/^0x[0-9a-f]{40}$/.test(address)||!/^0x[0-9a-f]{64}$/.test(sha256||'')||!/^0x[0-9a-fA-F]{128,8192}$/.test(signature||'')||!Number.isSafeInteger(issuedAt)||issuedAt*1000>clock()+30000||clock()-issuedAt*1000>600000)throw error('The image authorization is invalid or expired. Review the upload again.',401);
      if(typeof image!=='string'||image.length>IMAGE_MAX_BYTES*4/3+4||!image.length||image.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(image))throw error('Choose an image smaller than 3 MB.',413);
      const bytes=Buffer.from(image,'base64');if(bytes.length>IMAGE_MAX_BYTES||bytes.toString('base64')!==image)throw error('Choose a valid image smaller than 3 MB.',413);
      if(digest(bytes)!==sha256)throw error('The selected image changed. Select it again.',400);
      if(!await authorize(address,imageUploadMessage(address,sha256,issuedAt),signature))throw error('The wallet did not authorize this image upload.',401);
      rate('wallet:'+address);
      const key=address+':'+sha256,existing=saved.get(key);if(existing&&clock()-existing.at<600000)return res.status(200).json(existing.body);
      const normalized=await normalizeImage(bytes),imageHash=digest(normalized.bytes).slice(2),day=new Date(issuedAt*1000).toISOString().slice(0,10),prefix='launch-images/v1/'+address+'/'+day+'/',pathname=prefix+imageHash+'.png';
      let blob=await storage.find(pathname);
      if(!blob){
        const recent=await storage.list(prefix,8);if(recent.length>=8)throw error('This wallet has uploaded 8 images today. Reuse an uploaded image or try again tomorrow.',429);
        // Another request can finish the same immutable upload between head and put.
        try{blob=await storage.put(pathname,normalized.bytes);}catch(e){blob=await storage.find(pathname);if(!blob)throw e;}
      }
      const url=uploadedImageUrl(blob?.url);if(!url)throw error('Image storage returned an unexpected address. Please try again.',503);
      await verifyPublic(url,normalized.bytes);
      const result={url,sha256:'0x'+imageHash,width:normalized.width,height:normalized.height,size:normalized.bytes.length};
      if(saved.size>=500)saved.delete(saved.keys().next().value);saved.set(key,{at:clock(),body:result});return res.status(200).json(result);
    }catch(e){return res.status(e.status||503).json({error:e.status?e.message:'Image hosting is temporarily unavailable. Your token has not been launched. Please try again.'});}
  };
}
