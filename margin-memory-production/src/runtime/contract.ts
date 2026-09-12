import {z} from 'zod'
export const InvocationSchema=z.object({organizationId:z.string().uuid(),estimateId:z.string().uuid(),investigationId:z.string().uuid(),accessToken:z.string().min(20).max(12000)}).strict()
export type Invocation=z.infer<typeof InvocationSchema>
export const InvocationResultSchema=z.object({investigationId:z.string().uuid(),mode:z.enum(['strands','deterministic'])}).strict()
export function runtimeSelection(env:Record<string,string|undefined>=process.env){
 const runtime=env.AGENT_RUNTIME||'local'
 if(runtime!=='local'&&runtime!=='agentcore')throw new Error('AGENT_RUNTIME must be local or agentcore')
 if(runtime==='agentcore'&&!/^arn:aws(?:-[a-z]+)?:bedrock-agentcore:[a-z0-9-]+:\d{12}:runtime\//.test(env.AGENTCORE_RUNTIME_ARN||''))throw new Error('AGENTCORE_RUNTIME_ARN is required for remote execution')
 return runtime
}
