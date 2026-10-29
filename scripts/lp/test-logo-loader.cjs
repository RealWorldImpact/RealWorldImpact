const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),esbuild=require('esbuild');
const out=path.join(os.tmpdir(),'rwi-lp-logo-loader-'+process.pid+'.cjs');esbuild.buildSync({entryPoints:[path.join(__dirname,'logo-loader.js')],outfile:out,bundle:true,platform:'node',format:'cjs'});const {createLogoLoader}=require(out);fs.unlinkSync(out);
class FakeImage{
 static items=[];
 constructor(){this.naturalWidth=0;this.naturalHeight=0;FakeImage.items.push(this);}
 set src(value){this.url=value;}get src(){return this.url;}
 loaded(size){this.naturalWidth=this.naturalHeight=size;this.onload?.();}
 failed(){this.onerror?.();}
}
const token={address:'0x46d885131efeb8f6ab5736f17f2b3a2f44588ba3',logo:'https://example.com/slow.png'};
(async()=>{
 let ready=null,loader=createLogoLoader({ImageClass:FakeImage,timeoutMs:1000});loader.load(token,r=>{ready=r;});assert(FakeImage.items.length>=2,'sources should start in parallel');FakeImage.items.find(i=>i.url?.includes('size=xl')).loaded(800);assert.equal(ready.width,800);assert(ready.src.includes('size=xl'));
 const count=FakeImage.items.length;ready=null;loader.load(token,r=>{ready=r});await Promise.resolve();assert.equal(FakeImage.items.length,count,'repeat selection should use cache');assert.equal(ready.width,800);
 FakeImage.items=[];ready=null;loader=createLogoLoader({ImageClass:FakeImage,timeoutMs:1000});loader.load(token,r=>{ready=r});FakeImage.items[0].loaded(64);assert.equal(ready,null,'low resolution must not beat a pending sharp image');FakeImage.items.find(i=>i.url?.includes('size=xl')).loaded(800);assert.equal(ready.width,800);
 FakeImage.items=[];ready=null;loader=createLogoLoader({ImageClass:FakeImage,timeoutMs:1000});const cancel=loader.load(token,r=>{ready=r});const old=FakeImage.items[0],handler=old.onload;cancel();old.naturalWidth=800;handler();assert.equal(ready,null,'cancelled token cannot update selection');
 FakeImage.items=[];ready=null;loader=createLogoLoader({ImageClass:FakeImage,timeoutMs:10});loader.load({address:'0x1111111111111111111111111111111111111111'},r=>{ready=r});for(let i=0;i<FakeImage.items.length;i++)FakeImage.items[i].failed();assert.equal(ready,null);
 FakeImage.items=[];ready=null;loader=createLogoLoader({ImageClass:FakeImage,timeoutMs:1000});loader.load({address:'0x0bd7d308f8e1639fab988df18a8011f41eacad73'},r=>{ready=r});assert.equal(FakeImage.items[0].url,'/assets/weth-logo.png');FakeImage.items[0].loaded(192);assert.equal(ready.width,192);
 console.log('PASS: concurrent logo loading, immediate sharp result, cached selections, quality preference, cancellation, all-source failures, and bundled WETH.');
})().catch(e=>{console.error(e);process.exitCode=1});
