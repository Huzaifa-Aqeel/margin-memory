import 'server-only'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export async function getCurrentWorkspace() {
  const supabase = await createClient()
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims()
  if (claimsError || !claimsData?.claims?.sub) return { supabase, userId: null as string | null, workspace: null as { id:string; name:string; role:string } | null }
  const userId = String(claimsData.claims.sub)
  const { data, error } = await supabase
    .from('organization_members')
    .select('organization_id, role, organizations(id,name)')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  const org = data?.organizations as unknown as { id:string; name:string } | null
  return { supabase, userId, workspace: data && org ? { id: data.organization_id as string, name: org.name, role: data.role as string } : null }
}

export async function requireWorkspace() {
  const context = await getCurrentWorkspace()
  if (!context.userId) redirect('/login')
  if (!context.workspace) redirect('/onboarding')
  return context as typeof context & { userId:string; workspace:{id:string;name:string;role:string} }
}
