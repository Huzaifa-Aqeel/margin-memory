import 'server-only'
import {createClient} from '@supabase/supabase-js'
import {z} from 'zod'
import type {Invocation} from './contract'
export class RuntimeAuthenticationError extends Error{}
export async function authenticateInvocation(input:Invocation){
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
 if(!url||!key)throw new Error('Supabase runtime configuration is missing')
 const supabase=createClient(url,key,{global:{headers:{Authorization:`Bearer ${input.accessToken}`}},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})
 const {data,error}=await supabase.auth.getUser(input.accessToken)
 if(error||!data.user)throw new RuntimeAuthenticationError('Valid Supabase identity required')
 const member=await supabase.from('organization_members').select('organization_id').eq('organization_id',input.organizationId).eq('user_id',data.user.id).maybeSingle()
 if(member.error)throw member.error
 if(!member.data)throw new RuntimeAuthenticationError('Workspace access required')
 const investigation=await supabase.from('investigations').select('id').eq('organization_id',input.organizationId).eq('estimate_id',input.estimateId).eq('id',input.investigationId).maybeSingle()
 if(investigation.error)throw investigation.error
 if(!z.object({id:z.string().uuid()}).safeParse(investigation.data).success)throw new RuntimeAuthenticationError('Investigation access required')
 return {supabase,organizationId:input.organizationId,userId:data.user.id}
}
