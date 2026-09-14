import {z} from 'zod'
const responseSchema=z.record(z.string(),z.unknown())
export async function postJson(url:string,body?:unknown):Promise<Record<string,unknown>>{
 let response:Response
 try{response=await fetch(url,{method:'POST',...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)}),signal:AbortSignal.timeout(300000)})}
 catch(error){throw new Error('The request did not finish. Check your connection and retry; saved changes will be preserved.',{cause:error})}
 let data:Record<string,unknown>
 try{data=responseSchema.parse(await response.json())}
 catch(error){throw new Error('The server returned an unreadable response. Refresh to check saved changes before retrying.',{cause:error})}
 if(!response.ok)throw new Error(typeof data.error==='string'?data.error:`The request failed (HTTP ${response.status}). Please retry.`)
 return data
}
export async function performMutation<T>(action:()=>Promise<T>,state:{busy:(value:boolean)=>void;error:(message:string)=>void},success:(value:T)=>void){
 state.busy(true);state.error('')
 try{success(await action())}
 catch(error){state.error(error instanceof Error?error.message:'The request could not be completed. Please retry.')}
 finally{state.busy(false)}
}
