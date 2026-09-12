import {NextResponse} from 'next/server'
export function isPublicAuthPath(path:string){return ['/login','/signup','/auth/confirm','/error'].some(route=>path===route||path===`${route}/`)}
/** Redirects must carry refreshed/cleared session cookies from Supabase. */
export function redirectWithSessionCookies(url:URL,source:NextResponse){
 const response=NextResponse.redirect(url)
 for(const cookie of source.cookies.getAll())response.cookies.set(cookie)
 return response
}
