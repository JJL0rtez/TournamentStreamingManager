import http from 'node:http';
import {safeEqual,sign} from './core.mjs';
const MAX=8192;
export function createCoordinatorServer(store,{secret,host='127.0.0.1',port=43177}={}){
 if(!secret||secret.length<32)throw Error('COORDINATOR_SECRET_MIN_32_CHARS');
 const server=http.createServer(async(req,res)=>{
  const send=(status,data)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));};
  if(req.method==='GET'&&req.url==='/health'){send(200,{ok:true});return;}
  if(req.method!=='POST'||req.url!=='/v1/lease'){send(404,{error:'NOT_FOUND'});return;}
  let raw='';try{for await(const chunk of req){raw+=chunk.toString();if(raw.length>MAX){send(413,{error:'BODY_TOO_LARGE'});return;}}
   const timestamp=Number(req.headers['x-tsm-timestamp']);if(!Number.isSafeInteger(timestamp)||Math.abs(Date.now()-timestamp)>30000){send(401,{error:'TIMESTAMP_INVALID'});return;}
   const expected=sign(`${timestamp}.${raw}`,secret);if(!safeEqual(expected,req.headers['x-tsm-signature'])){send(401,{error:'UNAUTHORIZED'});return;}
   const body=JSON.parse(raw);const result=await store.execute(body);send(result.ok?200:409,result);
  }catch(e){send(e.message==='INVALID_REQUEST'||e.message==='INVALID_LEASE_ID'?400:503,{error:['INVALID_REQUEST','INVALID_LEASE_ID'].includes(e.message)?e.message:'COORDINATOR_UNAVAILABLE'});}
 });
 return {server,listen:()=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.removeListener('error',reject);resolve(server.address());});})};
}
