const $=id=>document.getElementById(id);
const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
export const initialCrop=()=>({zoom:1,x:0,y:0,turn:0});
export function cropGeometry(width,height,crop,side){
  const rotated=crop.turn%2!==0,w=rotated?height:width,h=rotated?width:height;
  const scale=Math.max(side/w,side/h)*crop.zoom;
  return {scale,overX:Math.max(0,(w*scale-side)/2),overY:Math.max(0,(h*scale-side)/2)};
}
export function cropResolution(width,height,zoom){return Math.min(512,Math.floor(Math.min(width,height)/zoom));}
export function drawCrop(canvas,image,crop,side){
  canvas.width=canvas.height=side;
  const ctx=canvas.getContext('2d'),g=cropGeometry(image.naturalWidth,image.naturalHeight,crop,side);
  if(!ctx)throw Error('Your browser could not open the image editor. Try another browser.');
  ctx.clearRect(0,0,side,side);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.save();
  ctx.beginPath();ctx.arc(side/2,side/2,side/2,0,Math.PI*2);ctx.clip();
  ctx.translate(side/2+crop.x*g.overX,side/2+crop.y*g.overY);ctx.rotate(crop.turn*Math.PI/2);ctx.scale(g.scale,g.scale);
  ctx.drawImage(image,-image.naturalWidth/2,-image.naturalHeight/2);ctx.restore();
}
export function createImageCropEditor({onApply,onCancel,onError}){
  const panel=$('launchImageEditor'),canvas=$('launchImageCanvas'),zoom=$('launchImageZoom'),apply=$('launchImageApply');
  let image=null,crop=initialCrop(),generation=0,drag=null,saving=false;
  function render(){
    if(!image)return;drawCrop(canvas,image,crop,512);zoom.value=String(crop.zoom);
    $('launchImageZoomValue').textContent=Math.round(crop.zoom*100)+'%';
    zoom.setAttribute('aria-valuetext',Math.round(crop.zoom*100)+' percent');
  }
  function close(){generation++;image=null;drag=null;saving=false;apply.disabled=false;panel.hidden=true;}
  function open(value,settings=initialCrop()){
    generation++;image=value;crop={...settings};drag=null;saving=false;apply.disabled=false;
    zoom.max=String(Math.min(4,Math.min(image.naturalWidth,image.naturalHeight)/128));
    $('launchImageCropHelp').textContent=Number(zoom.max)<=1?'Drag to reposition. Upload a larger image to zoom in. Only the circle is saved.':'Drag to reposition, or use the arrow keys. Only the circle is saved.';
    zoom.disabled=Number(zoom.max)<=1;panel.hidden=false;render();canvas.focus({preventScroll:true});
  }
  zoom.addEventListener('input',()=>{if(!image||saving)return;crop.zoom=clamp(Number(zoom.value)||1,1,Number(zoom.max));render();});
  $('launchImageRotate').onclick=()=>{if(!image||saving)return;crop={...crop,turn:(crop.turn+1)%4,x:-crop.y,y:crop.x};render();};
  $('launchImageReset').onclick=()=>{if(!image||saving)return;crop=initialCrop();render();};
  $('launchImageCancel').onclick=()=>{close();onCancel();};
  function move(dx,dy){
    const g=cropGeometry(image.naturalWidth,image.naturalHeight,crop,canvas.getBoundingClientRect().width);
    crop.x=g.overX?clamp(crop.x+dx/g.overX,-1,1):0;crop.y=g.overY?clamp(crop.y+dy/g.overY,-1,1):0;render();
  }
  canvas.addEventListener('pointerdown',event=>{
    if(!image||saving||event.button!==0||drag)return;drag={id:event.pointerId,x:event.clientX,y:event.clientY};canvas.setPointerCapture(event.pointerId);canvas.focus({preventScroll:true});event.preventDefault();
  });
  canvas.addEventListener('pointermove',event=>{if(!image||saving||drag?.id!==event.pointerId)return;move(event.clientX-drag.x,event.clientY-drag.y);drag.x=event.clientX;drag.y=event.clientY;});
  for(const name of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(name,event=>{if(drag?.id===event.pointerId)drag=null;});
  canvas.addEventListener('keydown',event=>{
    if(!image||saving)return;const distance=event.shiftKey?20:5,delta={ArrowLeft:[-distance,0],ArrowRight:[distance,0],ArrowUp:[0,-distance],ArrowDown:[0,distance]}[event.key];
    if(delta){event.preventDefault();move(...delta);}
  });
  apply.onclick=async()=>{
    if(!image||saving)return;const request=generation,settings={...crop};saving=true;apply.disabled=true;
    try{
      const output=document.createElement('canvas');drawCrop(output,image,settings,cropResolution(image.naturalWidth,image.naturalHeight,settings.zoom));
      const blob=await new Promise((resolve,reject)=>output.toBlob(value=>value?resolve(value):reject(Error('The image could not be saved. Please try again.')),'image/png'));
      if(request!==generation)return;await onApply(blob,settings);if(request===generation)close();
    }catch(error){if(request===generation){saving=false;apply.disabled=false;onError(error);}}
  };
  return {open,close};
}
