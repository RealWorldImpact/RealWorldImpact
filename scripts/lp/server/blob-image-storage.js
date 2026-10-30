// Receive the class from the same SDK import as head. Serverless builds can load
// both ESM and CJS SDK copies, whose otherwise identical Error classes differ.
export function createBlobImageStorage({head,list,put,BlobNotFoundError}){
  return {
    async find(pathname){try{return await head(pathname);}catch(e){if(e instanceof BlobNotFoundError)return null;throw e;}},
    async list(prefix,limit){return (await list({prefix,limit})).blobs;},
    put(pathname,bytes){return put(pathname,bytes,{access:'public',contentType:'image/png',addRandomSuffix:false,allowOverwrite:false,cacheControlMaxAge:31536000});}
  };
}
