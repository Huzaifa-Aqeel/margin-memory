import {runtimeSelection} from '@/runtime/contract'
import {invokeAgentCore} from '@/runtime/invoke'
import 'server-only'
import {createInvestigation,getAuthenticatedSupabase,getEstimate} from '@/lib/repository/store'
import {executeInvestigation} from './runtime'
import {repairMemory} from '@/lib/repository/memory'
import {embeddingsEnabled} from '@/lib/embeddings/provider'

export async function runPreflight(estimateId:string){
 const auth=await getAuthenticatedSupabase()
 const selection=runtimeSelection()
 if(embeddingsEnabled())try{await repairMemory()}catch(error){console.error('Automatic memory reconciliation did not complete; retrieval will fail closed to current indexed memory.',error)}
 const{investigation}=await createInvestigation(estimateId)
 if(selection==='agentcore'){
  const {data,error}=await auth.supabase.auth.getSession()
  if(error)throw error
  if(!data.session)throw new Error('Sign in again before running a review')
  // Identity is independently verified by the runtime; no refresh token or secret leaves this server.
  await invokeAgentCore({organizationId:auth.organizationId,estimateId,investigationId:investigation.id,accessToken:data.session.access_token})
 }else await executeInvestigation(auth,estimateId,investigation.id)
 return getEstimate(estimateId)
}
