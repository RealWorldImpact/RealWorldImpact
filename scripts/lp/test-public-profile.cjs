const assert=require('assert/strict'),sharp=require('../../node_modules/sharp'),{Wallet,sha256,verifyMessage}=require('ethers');
(async()=>{
 const P=await import('./profile-policy.js'),{createProfileHandler}=await import('./server/profile-api.js'),{createProfileStorage}=await import('./server/profile-storage.js'),sdk=await import('@vercel/blob');
 const {IMAGE_STORE_ORIGIN}=await import('./launch-image-policy.js'),wallet=Wallet.createRandom(),stranger=Wallet.createRandom(),address=wallet.address.toLowerCase();let now=Date.now(),counter=0,record=null,etag=null,puts=0,publicChecks=0,broken=false;const blobs=new Map();
 const storage={read:async()=>record?{record:{...record},etag}:null,write:async(a,value,expected)=>{assert.equal(a,address);if(expected!==etag&&!(expected===undefined&&etag===null))throw Object.assign(Error('Conflict'),{status:409});record={...value};etag='e'+(++counter);}};
 const images={find:async p=>blobs.get(p)||null,put:async(p,bytes)=>{assert.equal((await sharp(bytes).metadata()).format,'png');puts++;const blob={url:IMAGE_STORE_ORIGIN+'/'+p};blobs.set(p,blob);return blob;}};
 const authorize=async(a,m,s)=>{try{return verifyMessage(m,s).toLowerCase()===a}catch{return false}};
 const handler=createProfileHandler({storage,images,authorize,clock:()=>now,verifyPublic:async()=>{publicChecks++;if(broken)throw Error('broken image');}});
 const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v},status(n){this.code=n;return this},json(b){this.body=b;return this}});
 async function call(body,method='POST',query={},headers={}){const r=response();await handler({method,query:method==='GET'?{address,...query}:query,headers:{origin:'https://www.rwihood.org','content-type':'application/json',...headers},body},r);return r;}
 async function signed(overrides={},signer=wallet){const b={address,displayName:'My RWI profile',bio:'Building on Robinhood',revision:record?.revision||'0',imageAction:'keep',sha256:'',issuedAt:Math.floor(now/1000),...overrides};b.signature=await signer.signMessage(P.profileUpdateMessage(b));return b;}
 assert.equal((await call(null,'GET')).body.revision,'0');assert.equal((await call(null,'GET',{address:'bad'})).code,400);assert.equal((await call(null,'DELETE')).code,405);
 const png=await sharp({create:{width:512,height:512,channels:4,background:'#bfff00'}}).withMetadata().png().toBuffer(),upload=await signed({imageAction:'upload',sha256:sha256(png),image:png.toString('base64')});
 let r=await call({...upload,address:stranger.address});assert.equal(r.code,401);assert.equal(puts,0);
 r=await call({...upload,bio:'Tampered'});assert.equal(r.code,401);r=await call({...upload,image:Buffer.from('bad').toString('base64')});assert.equal(r.code,400);
 r=await call(upload);assert.equal(r.code,200);const first=r.body;assert.equal(first.displayName,'My RWI profile');assert(P.profileImageUrl(first.avatar,address));assert.equal(puts,1);assert.equal(publicChecks,1);assert.equal(first.requestHash,undefined);assert.equal(first.signature,undefined);
 assert.deepEqual((await call(null,'GET')).body,first,'public readers need no wallet or signature');assert.deepEqual((await call(upload)).body,first,'lost-response retry is idempotent');assert.equal(counter,1);
 const second=await signed({displayName:'Updated'});r=await call(second);assert.equal(r.code,200);assert.equal(r.body.avatar,first.avatar);assert.equal((await call(upload)).code,409,'an old signature cannot restore an earlier profile');
 const before={...record};broken=true;r=await call(await signed({imageAction:'upload',sha256:sha256(png),image:png.toString('base64')}));assert.equal(r.code,503);assert.deepEqual(record,before);broken=false;
 r=await call(await signed({imageAction:'remove',displayName:'',bio:''}));assert.equal(r.code,200);assert.equal(r.body.avatar,'');assert.equal(r.body.displayName,'');assert.equal((await call(second)).code,409);
 now+=61000;const a=await signed({bio:'First tab'}),b=await signed({bio:'Second tab'});const results=await Promise.all([call(a),call(b)]);assert.deepEqual(results.map(x=>x.code).sort(),[200,409]);assert(['First tab','Second tab'].includes(record.bio));
 r=await call(await signed(),undefined,{}, {origin:'https://evil.example'});assert.equal(r.code,403);r=await call(await signed(),undefined,{}, {'content-type':'text/plain'});assert.equal(r.code,415);
 r=await call(await signed({issuedAt:Math.floor(now/1000)-601}));assert.equal(r.code,401);r=await call(await signed({issuedAt:Math.floor(now/1000)+31}));assert.equal(r.code,401);
 const badImage=Buffer.from('<svg onload=alert(1)>');r=await call(await signed({imageAction:'upload',sha256:sha256(badImage),image:badImage.toString('base64')}));assert.equal(r.code,400);
 for(const fields of [{displayName:'a'.repeat(33),bio:''},{displayName:'Bad\nName',bio:''},{displayName:'name',bio:'x'.repeat(161)},{displayName:'\u202eevil',bio:''}])assert.throws(()=>P.profileFields(fields));
 assert.equal(P.profileImageUrl(first.avatar,stranger.address),'');assert.equal(P.profileImageUrl(first.avatar+'?fake=1',address),'');assert.throws(()=>P.readPublicProfile({...first,avatar:'https://evil.example/a.png'},address));
 now+=61000;while(record.saveCount<12){assert.equal((await call(await signed({bio:'Save '+record.saveCount}))).code,200);}assert.equal((await call(await signed({bio:'Over limit'}))).code,429);
 const adapter=createProfileStorage({...sdk,get:async(p,o)=>{assert.equal(o.useCache,false);return {statusCode:200,blob:{etag:'latest',size:10},stream:new Blob([JSON.stringify(first)]).stream()};},put:async(p,b,o)=>{assert.equal(o.ifMatch,'latest');assert.equal(o.addRandomSuffix,false);assert.equal(o.access,'public');assert.equal(o.cacheControlMaxAge,60);}});
 assert.equal((await adapter.read(address)).etag,'latest');await adapter.write(address,first,'latest');assert.equal(await createProfileStorage({...sdk,get:async()=>{throw new sdk.BlobNotFoundError()}}).read(address),null);
 await assert.rejects(createProfileStorage({...sdk,put:async()=>{throw new sdk.BlobPreconditionFailedError()}}).write(address,first,'old'),e=>e.status===409);
 console.log('PASS: public persistence, signed owner/content/image binding, replay and concurrent-update rejection, idempotent retries, removal, invalid images, failed-image atomicity, daily limits and origin-storage conditional writes.');
})().catch(e=>{console.error(e);process.exitCode=1});
