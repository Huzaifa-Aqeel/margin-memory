import 'server-only'
import {BedrockAgentCoreClient,InvokeAgentRuntimeCommand} from '@aws-sdk/client-bedrock-agentcore'
import {InvocationSchema,InvocationResultSchema,type Invocation} from './contract'
export async function invokeAgentCore(input:Invocation){
 const payload=InvocationSchema.parse(input)
 const client=new BedrockAgentCoreClient({region:process.env.AWS_REGION||'us-east-1',maxAttempts:1})
 const response=await client.send(new InvokeAgentRuntimeCommand({agentRuntimeArn:process.env.AGENTCORE_RUNTIME_ARN,qualifier:'DEFAULT',runtimeSessionId:input.investigationId,contentType:'application/json',accept:'application/json',payload:new TextEncoder().encode(JSON.stringify(payload))}),{abortSignal:AbortSignal.timeout(280000)})
 if(!response.response)throw new Error('AgentCore returned no result')
 const text=await response.response.transformToString()
 if(response.statusCode!==200)throw new Error(`AgentCore investigation failed (HTTP ${response.statusCode})`)
 const result=InvocationResultSchema.parse(JSON.parse(text))
 if(result.investigationId!==input.investigationId)throw new Error('AgentCore returned a different investigation')
 return result
}
