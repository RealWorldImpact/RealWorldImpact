export function createProfileStorage({get,put,BlobNotFoundError,BlobPreconditionFailedError}){
  const path=address=>'profiles/v1/'+address+'.json';
  return {
    async read(address){
      let result;try{result=await get(path(address),{access:'public',useCache:false});}catch(e){if(e instanceof BlobNotFoundError)return null;throw e;}
      if(!result)return null;if(result.statusCode!==200||!result.blob?.etag||result.blob.size>8192)throw Error('Invalid stored profile');
      const raw=await new Response(result.stream).text();if(raw.length>8192)throw Error('Invalid stored profile');return {record:JSON.parse(raw),etag:result.blob.etag};
    },
    async write(address,record,etag){
      try{return await put(path(address),JSON.stringify(record),{access:'public',contentType:'application/json',addRandomSuffix:false,cacheControlMaxAge:60,...(etag?{ifMatch:etag}:{allowOverwrite:false})});}
      catch(e){if(e instanceof BlobPreconditionFailedError||/already exists/i.test(e.message))throw Object.assign(Error('Your profile changed in another session. Reopen the editor and try again.'),{status:409});throw e;}
    }
  };
}
