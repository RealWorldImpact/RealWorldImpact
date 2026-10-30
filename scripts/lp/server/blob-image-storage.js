import { BlobNotFoundError } from '@vercel/blob';
export function createBlobImageStorage({head,list,put}){
  return {
    async find(pathname){try{return await head(pathname);}catch(e){if(e instanceof BlobNotFoundError)return null;throw e;}},
    async list(prefix,limit){return (await list({prefix,limit})).blobs;},
    put(pathname,bytes){return put(pathname,bytes,{access:'public',contentType:'image/png',addRandomSuffix:false,allowOverwrite:false,cacheControlMaxAge:31536000});}
  };
}
