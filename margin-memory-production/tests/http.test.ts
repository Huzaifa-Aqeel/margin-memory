import{beforeAll,afterAll,it,expect}from'vitest'
import{createServer}from'node:http'
import{once}from'node:events'
import{postJson,performMutation}from'../src/lib/http'
const server=createServer((req,res)=>{
 if(req.url==='/disconnect'){req.socket.destroy();return}
 if(req.url==='/invalid'){res.end('<html>upstream error</html>');return}
 if(req.url==='/error'){res.writeHead(409,{'content-type':'application/json'});res.end(JSON.stringify({error:'Investigation already running'}));return}
 res.setHeader('content-type','application/json');res.end(JSON.stringify({saved:true}))
})
let url:string
beforeAll(async()=>{server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address==='string')throw Error('Missing TCP address');url=`http://127.0.0.1:${address.port}`})
afterAll(async()=>{server.close();await once(server,'close')})
it.each(['/disconnect','/invalid','/error'])('releases busy state and shows failures from a real HTTP server: %s',async path=>{
 const busy:boolean[]=[],errors:string[]=[];let saved=false
 await performMutation(()=>postJson(url+path),{busy:value=>busy.push(value),error:value=>errors.push(value)},()=>{saved=true})
 expect(busy).toEqual([true,false]);expect(errors.at(-1)?.length).toBeGreaterThan(10);expect(saved).toBe(false)
})
it('refreshes after confirmed success and releases busy state',async()=>{
 const busy:boolean[]=[];let saved=false
 await performMutation(()=>postJson(url+'/success',{status:'confirmed'}),{busy:value=>busy.push(value),error:()=>{}},data=>{saved=data.saved===true})
 expect(saved).toBe(true);expect(busy).toEqual([true,false])
})
