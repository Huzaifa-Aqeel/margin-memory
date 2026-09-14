/** Heartbeats during model I/O as well as at tool boundaries. Loss aborts execution and prevents commit. */
export async function withLease<T>(renew:()=>Promise<void>,run:(heartbeat:()=>Promise<void>,signal:AbortSignal)=>Promise<T>,intervalMs=20000):Promise<T>{
 const controller=new AbortController();let failure:unknown;let inFlight:Promise<void>|undefined
 const heartbeat=async()=>{
  if(failure)throw failure
  if(!inFlight)inFlight=renew().catch(error=>{failure=error;controller.abort(error);throw error}).finally(()=>{inFlight=undefined})
  await inFlight
 }
 await heartbeat()
 const timer=setInterval(()=>{void heartbeat().catch(error=>{failure=error})},intervalMs)
 try{const result=await run(heartbeat,controller.signal);await heartbeat();return result}
 finally{clearInterval(timer);await inFlight}
}
