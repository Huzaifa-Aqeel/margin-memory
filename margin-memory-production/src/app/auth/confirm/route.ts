import type { EmailOtpType } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
export async function GET(request:NextRequest){const token_hash=request.nextUrl.searchParams.get('token_hash');const type=request.nextUrl.searchParams.get('type') as EmailOtpType|null;const redirectTo=request.nextUrl.clone();redirectTo.pathname='/onboarding';redirectTo.search='';if(token_hash&&type){const supabase=await createClient();const{error}=await supabase.auth.verifyOtp({type,token_hash});if(!error)return NextResponse.redirect(redirectTo)}redirectTo.pathname='/error';return NextResponse.redirect(redirectTo)}
