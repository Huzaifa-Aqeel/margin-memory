import {runtimeSelection} from '@/runtime/contract'
import {invokeAgentCore} from '@/runtime/invoke'
import 'server-only'
import {createInvestigation,getAuthenticatedSupabase,getEstimate} from '@/lib/repository/store'
import {executeInvestigation} from './runtime'

export async function runPreflight(estimateId:string){
 const auth=await getAuthenticatedSupabase()
 const selection=runtimeSelection()
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
