import { head, list, put } from '@vercel/blob';
import { createHash } from 'node:crypto';
import { createImageUploadHandler } from '../scripts/lp/server/launch-image-upload.js';
const storage={
  async find(pathname){try{return await head(pathname);}catch(e){if(e.name==='BlobNotFoundError')return null;throw e;}},
  async list(prefix,limit){return (await list({prefix,limit})).blobs;},
  put(pathname,bytes){return put(pathname,bytes,{access:'public',contentType:'image/png',addRandomSuffix:false,allowOverwrite:false,cacheControlMaxAge:31536000});}
};
export default createImageUploadHandler({storage,
  allowedOrigins:['https://www.rwihood.org','https://rwihood.org',...(process.env.VERCEL_URL?['https://'+process.env.VERCEL_URL]:[])],
  async verifyPublic(url,expected){
    const response=await fetch(url,{signal:AbortSignal.timeout(10000),redirect:'error'});
    if(!response.ok||!response.headers.get('content-type')?.startsWith('image/png'))throw Error('Image is not publicly available.');
    const length=Number(response.headers.get('content-length'));if(!length||length!==expected.length)throw Error('Image length mismatch.');
    const actual=Buffer.from(await response.arrayBuffer());if(createHash('sha256').update(actual).digest('hex')!==createHash('sha256').update(expected).digest('hex'))throw Error('Image integrity mismatch.');
  }
});
