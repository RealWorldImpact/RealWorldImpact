import { head, list, put } from '@vercel/blob';
import { createHash } from 'node:crypto';
import { createImageUploadHandler } from '../scripts/lp/server/launch-image-upload.js';
import { createBlobImageStorage } from '../scripts/lp/server/blob-image-storage.js';
const storage=createBlobImageStorage({head,list,put});
export default createImageUploadHandler({storage,
  // Operational diagnostics contain no wallet, image, signature, or credentials.
  onError(stage,error){console.error('Token image hosting failure',stage,error.constructor?.name,/No blob credentials/.test(error.message)?'missing-auth':/environment/.test(error.message)?'environment-access':/storeId/.test(error.message)?'missing-store':'provider-error');},
  allowedOrigins:['https://www.rwihood.org','https://rwihood.org',...(process.env.VERCEL_URL?['https://'+process.env.VERCEL_URL]:[])],
  async verifyPublic(url,expected){
    const response=await fetch(url,{signal:AbortSignal.timeout(10000),redirect:'error'});
    if(!response.ok||!response.headers.get('content-type')?.startsWith('image/png'))throw Error('Image is not publicly available.');
    const length=Number(response.headers.get('content-length'));if(!length||length!==expected.length)throw Error('Image length mismatch.');
    const actual=Buffer.from(await response.arrayBuffer());if(createHash('sha256').update(actual).digest('hex')!==createHash('sha256').update(expected).digest('hex'))throw Error('Image integrity mismatch.');
  }
});
