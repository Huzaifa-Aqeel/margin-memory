import 'server-only'
import {InvocationSchema} from './contract'
import {authenticateInvocation,RuntimeAuthenticationError} from './authenticate'
import {executeInvestigation} from '@/lib/agent/runtime'
export async function handleRuntimeRequest(request:Request):Promise<Response>{
 if(new URL(request.url).pathname==='/ping'&&request.method==='GET')return Response.json({status:'Healthy'})
 if(new URL(request.url).pathname!=='/invocations'||request.method!=='POST')return Response.json({error:'Not found'},{status:404})
 let raw:unknown
 try{raw=await request.json()}catch{return Response.json({error:'Invalid JSON'},{status:400})}
 const parsed=InvocationSchema.safeParse(raw)
 if(!parsed.success)return Response.json({error:'Invalid invocation'},{status:400})
 try{const context=await authenticateInvocation(parsed.data);const result=await executeInvestigation(context,parsed.data.estimateId,parsed.data.investigationId);return Response.json(result)}
 catch(error){if(error instanceof RuntimeAuthenticationError)return Response.json({error:error.message},{status:401});const code=typeof error==='object'&&error!==null&&'code' in error?error.code:undefined;console.error('Runtime investigation failed',{investigationId:parsed.data.investigationId,error:error instanceof Error?error.message:'Database operation failed'});return Response.json({error:code==='55P03'?'Investigation already executing':'Investigation failed; inspect server logs and retry after its lease expires.'},{status:code==='55P03'?409:500})}
}
