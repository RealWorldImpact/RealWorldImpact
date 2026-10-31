import { createHash,randomBytes } from 'node:crypto';
import { profileWallet,profileFields,profileUpdateMessage,profileImageUrl,readPublicProfile } from '../profile-policy.js';
import { IMAGE_MAX_BYTES } from '../launch-image-policy.js';
import { authorizeImage,normalizeImage } from './launch-image-upload.js';
const digest=b=>'0x'+createHash('sha256').update(b).digest('hex');
const fail=(message,status=400)=>Object.assign(Error(message),{status});
export function createProfileHandler({storage,images,authorize=authorizeImage,verifyPublic=async()=>{},clock=Date.now,allowedOrigins=['https://www.rwihood.org','https://rwihood.org'],onError=()=>{}}){
  const rates=new Map();
  function rate(key){const now=clock(),r=rates.get(key);if(r&&now-r.at<60000){if(++r.count>20)throw fail('Please wait a minute before trying again.',429);}else{if(rates.size>=1000)rates.delete(rates.keys().next().value);rates.set(key,{at:now,count:1});}}
  const empty=address=>({address,displayName:'',bio:'',avatar:'',revision:'0',updatedAt:0});
  return async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Method not allowed'});
    try{
      if(req.method==='GET'){
        let address;try{address=profileWallet(req.query.address);}catch{throw fail('Enter a valid wallet address.');}
        const saved=await storage.read(address);return res.status(200).json(readPublicProfile(saved?.record||empty(address),address));
      }
      if(!allowedOrigins.includes(req.headers?.origin))throw fail('Save your profile from RWI LP.',403);
      if(!String(req.headers?.['content-type']||'').startsWith('application/json'))throw fail('Invalid profile format.',415);
      if(Number(req.headers?.['content-length'])>4_300_000)throw fail('Choose an image smaller than 3 MB.',413);
      rate('ip:'+String(req.headers?.['x-forwarded-for']||'unknown').split(',')[0].slice(0,64));
      let input;try{input=typeof req.body==='string'?JSON.parse(req.body):req.body;}catch{throw fail('Invalid profile data.');}
      let address,fields,message;try{address=profileWallet(input?.address);fields=profileFields(input);message=profileUpdateMessage(input);}catch(e){throw fail(e.message);}
      if(input.issuedAt*1000>clock()+30000||clock()-input.issuedAt*1000>600000||!/^0x[0-9a-fA-F]{128,8192}$/.test(input.signature||''))throw fail('Your profile signature is invalid or expired. Save again.',401);
      if(!await authorize(address,message,input.signature))throw fail('Connect the profile owner’s wallet to save these changes.',401);
      rate('wallet:'+address);
      const saved=await storage.read(address),current=readPublicProfile(saved?.record||empty(address),address),requestHash=digest(message);
      if(saved?.record.requestHash===requestHash)return res.status(200).json(current);
      if(current.revision!==input.revision)throw fail('Your profile changed in another session. Reopen the editor and try again.',409);
      const day=new Date(clock()).toISOString().slice(0,10),count=saved?.record.saveDay===day?saved.record.saveCount:0;
      if(count>=12)throw fail('You can update your public profile 12 times per day. Try again tomorrow.',429);
      let avatar=input.imageAction==='remove'?'':current.avatar;
      if(input.imageAction==='upload'){
        const image=input.image;if(typeof image!=='string'||!image.length||image.length>IMAGE_MAX_BYTES*4/3+4||image.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(image))throw fail('Choose a valid image smaller than 3 MB.',413);
        const bytes=Buffer.from(image,'base64');if(bytes.length>IMAGE_MAX_BYTES||bytes.toString('base64')!==image||digest(bytes)!==input.sha256)throw fail('The selected image changed. Choose it again.');
        const normalized=await normalizeImage(bytes),path='profile-images/v1/'+address+'/'+digest(normalized.bytes).slice(2)+'.png';
        let blob=await images.find(path);if(!blob){try{blob=await images.put(path,normalized.bytes);}catch(e){blob=await images.find(path);if(!blob)throw e;}}
        avatar=profileImageUrl(blob?.url,address);if(!avatar)throw fail('Profile image hosting is unavailable. Try again.',503);
        await verifyPublic(avatar,normalized.bytes);
      }else if(input.image)throw fail('Unexpected profile image.');
      const record={address,...fields,avatar,revision:randomBytes(16).toString('hex'),updatedAt:clock(),requestHash,saveDay:day,saveCount:count+1};
      await storage.write(address,record,saved?.etag);return res.status(200).json(readPublicProfile(record,address));
    }catch(e){if(!e.status)onError(e);return res.status(e.status||503).json({error:e.status?e.message:'The profile update could not be confirmed. Reopen the editor to check your profile before trying again.'});}
  };
}
