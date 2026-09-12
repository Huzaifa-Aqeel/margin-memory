'use server'

import { safeLocalRedirect } from '@/lib/auth/redirect'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

function q(value:string){return encodeURIComponent(value)}

export async function loginAction(formData:FormData){
  const email=String(formData.get('email')||'').trim();const password=String(formData.get('password')||'');const next=String(formData.get('next')||'/')
  if(!email||!password)redirect(`/login?error=${q('Email and password are required.')}`)
  const supabase=await createClient();const{error}=await supabase.auth.signInWithPassword({email,password});if(error)redirect(`/login?error=${q(error.message)}`);redirect(safeLocalRedirect(next))
}
export async function signupAction(formData:FormData){
  const email=String(formData.get('email')||'').trim();const password=String(formData.get('password')||'');if(password.length<8)redirect(`/signup?error=${q('Use at least 8 characters for your password.')}`)
  const supabase=await createClient();const{data,error}=await supabase.auth.signUp({email,password});if(error)redirect(`/signup?error=${q(error.message)}`);if(data.session)redirect('/onboarding');redirect(`/login?message=${q('Check your email to confirm your account, then sign in.')}`)
}
export async function logoutAction(){const supabase=await createClient();await supabase.auth.signOut();redirect('/login')}
export async function createWorkspaceAction(formData:FormData){
  const name=String(formData.get('name')||'').trim();if(name.length<2)redirect(`/onboarding?error=${q('Enter your company name.')}`);const supabase=await createClient();const{data:claims}=await supabase.auth.getClaims();if(!claims?.claims)redirect('/login');const{error}=await supabase.rpc('create_organization',{p_name:name});if(error)redirect(`/onboarding?error=${q(error.message)}`);redirect('/')
}
