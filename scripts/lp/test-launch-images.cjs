const assert=require('node:assert/strict'),sharp=require('../../node_modules/sharp'),{Wallet,sha256,verifyMessage}=require('ethers');
(async()=>{
 const {normalizeImage,createImageUploadHandler}=await import('./server/launch-image-upload.js');
 const {createBlobImageStorage}=await import('./server/blob-image-storage.js'),{BlobNotFoundError}=await import('@vercel/blob');
 const adapter=createBlobImageStorage({BlobNotFoundError,head:async()=>{throw new BlobNotFoundError()},list:async()=>({blobs:[]}),put:async(_path,_bytes,options)=>options});
 assert.equal(await adapter.find('missing.png'),null,'SDK errors must use their class, not Error.name');
 assert.equal((await adapter.put('image.png',Buffer.alloc(0))).allowOverwrite,false);
 const cjsSdk=require('../../node_modules/@vercel/blob');assert.equal(await createBlobImageStorage({...cjsSdk,head:async()=>{throw new cjsSdk.BlobNotFoundError()}}).find('missing.png'),null);
 const {imageUploadMessage,uploadedImageUrl,IMAGE_STORE_ORIGIN}=await import('./launch-image-policy.js');
 const png=await sharp({create:{width:1024,height:512,channels:4,background:{r:180,g:220,b:0,alpha:.5}}}).png().toBuffer();
 const normalized=await normalizeImage(png),m=await sharp(normalized.bytes).metadata();assert.equal(m.width,512);assert.equal(m.height,256);assert.equal(m.hasAlpha,true);assert.equal(m.exif,undefined);
 const jpeg=await sharp({create:{width:600,height:300,channels:3,background:'#98ff00'}}).withMetadata({orientation:6}).jpeg().toBuffer();const oriented=await normalizeImage(jpeg);assert.equal(oriented.width,256);assert.equal(oriented.height,512);assert.equal((await sharp(oriented.bytes).metadata()).exif,undefined);
 const webp=await sharp(png).webp({lossless:true}).toBuffer();assert.equal((await normalizeImage(webp)).width,512);
 const tiny=await sharp({create:{width:16,height:16,channels:3,background:'red'}}).png().toBuffer();
 for(const bytes of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),Buffer.from('GIF89a0000000000'),png.subarray(0,70),tiny,Buffer.alloc(24)])await assert.rejects(normalizeImage(bytes));
 const animation=Buffer.concat([png.subarray(0,33),Buffer.from([0,0,0,8,97,99,84,76,0,0,0,2,0,0,0,0,0,0,0,0]),png.subarray(33)]);await assert.rejects(normalizeImage(animation),/still image/);
 const wide=await sharp({create:{width:8193,height:128,channels:3,background:'black'}}).png().toBuffer();await assert.rejects(normalizeImage(wide),/large/);
 const wallet=Wallet.createRandom(),now=Date.now(),issuedAt=Math.floor(now/1000),message=imageUploadMessage(wallet.address,sha256(png),issuedAt),signature=await wallet.signMessage(message);
 const body={address:wallet.address,sha256:sha256(png),issuedAt,signature,image:png.toString('base64')},blobs=new Map();let puts=0,verified=0;
 const storage={find:async p=>blobs.get(p)||null,list:async(prefix,limit)=>[...blobs.entries()].filter(([p])=>p.startsWith(prefix)).map(([,v])=>v).slice(0,limit),put:async(p,b)=>{puts++;assert.equal((await sharp(b).metadata()).format,'png');const value={url:IMAGE_STORE_ORIGIN+'/'+p};blobs.set(p,value);return value;}};
 const authorize=async(a,m,s)=>{try{return verifyMessage(m,s).toLowerCase()===a;}catch{return false;}};
 const handler=createImageUploadHandler({storage,authorize,clock:()=>now,verifyPublic:async(url,bytes)=>{assert.ok(uploadedImageUrl(url));assert.deepEqual(bytes,normalized.bytes);verified++;}});
 async function call(patch={},headers={}){const res={headers:{},setHeader(k,v){this.headers[k]=v},status(c){this.code=c;return this},json(b){this.body=b;return this}};await handler({method:'POST',headers:{origin:'https://www.rwihood.org','content-type':'application/json',...headers},body:{...body,...patch}},res);return res;}
 let r=await call();assert.equal(r.code,200);assert.ok(uploadedImageUrl(r.body.url));assert.equal(puts,1);assert.equal(verified,1);const first=r.body.url;
 r=await call();assert.equal(r.body.url,first);assert.equal(puts,1,'retry must not create another image');
 r=await call({}, {origin:'https://evil.example'});assert.equal(r.code,403);
 for(const patch of [{signature:'0x'+'00'.repeat(65)},{issuedAt:issuedAt-601},{issuedAt:issuedAt+100},{address:'bad'},{sha256:'0x'+'f'.repeat(64)}]){r=await call(patch);assert.ok([400,401].includes(r.code));}
 r=await call({image:'!not_base64'});assert.equal(r.code,413);r=await call({}, {'content-length':'4500000'});assert.equal(r.code,413);assert.equal(puts,1,'rejected requests cannot write storage');
 assert.equal(uploadedImageUrl('https://evil.example/logo.png'),'');assert.equal(uploadedImageUrl(first+'?changed=1'),'');assert.equal(uploadedImageUrl(first.replace('.png','.svg')),'');
 const unavailable=createImageUploadHandler({storage:{...storage,find:async()=>{throw Error('offline')}},authorize,clock:()=>now});const res={setHeader(){},status(c){this.code=c;return this},json(b){this.body=b}};await unavailable({method:'POST',headers:{'content-type':'application/json'},body},res);assert.equal(res.code,503);assert.match(res.body.error,/not been launched/);
 console.log('PASS: PNG/JPEG/WebP validation, lossless resizing, alpha and proportions, orientation and EXIF removal, corrupt/small/animated/oversized files, signed file binding, expired authorization, origin/size checks, immutable URL validation, upload deduplication and hosting failure.');
})().catch(e=>{console.error(e);process.exitCode=1});
