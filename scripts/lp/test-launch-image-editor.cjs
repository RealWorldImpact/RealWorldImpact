const assert=require('node:assert/strict');
(async()=>{
 const {cropGeometry,cropResolution,drawCrop}=await import('./launch-image-editor.js');
 const {checkStillImage}=await import('./launch-image-policy.js');
 for(const [width,height] of [[1024,512],[512,1024],[128,128],[128,8192],[8192,128]])for(const turn of [0,1,2,3])for(const zoom of [1,2,4]){
  const side=512,g=cropGeometry(width,height,{zoom,turn},side),w=turn%2?height:width,h=turn%2?width:height;
  assert.ok(w*g.scale>=side&&h*g.scale>=side,'every crop covers the circle without empty edges');
  for(const x of [-1,0,1]){assert.ok(side/2+x*g.overX-w*g.scale/2<=0);assert.ok(side/2+x*g.overX+w*g.scale/2>=side);}
  assert.ok(cropResolution(width,height,zoom)<=Math.min(width,height)/zoom,'export never upscales source pixels');
 }
 const calls=[],ctx=new Proxy({},{set(obj,key,value){obj[key]=value;return true},get(obj,key){return obj[key]??((...args)=>calls.push([key,...args]));}}),canvas={getContext:()=>ctx};
 drawCrop(canvas,{naturalWidth:1024,naturalHeight:512},{zoom:2,turn:1,x:1,y:-1},256);
 assert.equal(canvas.width,256);assert.equal(canvas.height,256);assert.equal(ctx.imageSmoothingQuality,'high');
 assert.ok(calls.findIndex(c=>c[0]==='clip')<calls.findIndex(c=>c[0]==='drawImage'),'round clipping is applied to exported pixels');
 assert.deepEqual(calls.find(c=>c[0]==='arc'),['arc',128,128,128,0,Math.PI*2]);
 const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.from([0,0,0,8,97,99,84,76]),Buffer.alloc(12)]);
 assert.throws(()=>checkStillImage(png),/still image/);
 const webp=Buffer.concat([Buffer.from('RIFF'),Buffer.alloc(4),Buffer.from('WEBPANIM'),Buffer.alloc(8)]);assert.throws(()=>checkStillImage(webp),/still image/);
 console.log('PASS: circular clipping, portrait/landscape crops, zoom and rotation bounds, no-upscale export and animation rejection.');
})().catch(error=>{console.error(error);process.exitCode=1});
