import {createServer} from 'node:http'
import {handleRuntimeRequest} from './handler'
const MAX_BODY=16384
const server=createServer(async(req,res)=>{
 try{
  const chunks:Buffer[]=[];let size=0
  for await(const chunk of req){const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=bytes.length;if(size>MAX_BODY){res.writeHead(413,{'content-type':'application/json'});res.end(JSON.stringify({error:'Invocation too large'}));return}chunks.push(bytes)}
  const request=new Request(`http://localhost:8080${req.url||'/'}`,{method:req.method,headers:{'content-type':String(req.headers['content-type']||'application/json')},body:req.method==='GET'||req.method==='HEAD'?undefined:Buffer.concat(chunks)})
  const response=await handleRuntimeRequest(request);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text())
 }catch(error){console.error('Runtime transport failed',error instanceof Error?error.message:'Transport error');if(!res.headersSent)res.writeHead(500);res.end()}
})
server.requestTimeout=300000
server.listen(8080,'0.0.0.0',()=>console.info('Margin Memory investigator listening on port 8080'))
