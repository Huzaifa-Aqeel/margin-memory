import {it,expect} from 'vitest'
import {NextResponse} from 'next/server'
import {isPublicAuthPath,redirectWithSessionCookies} from '../src/lib/auth/proxy-response'
it('keeps refreshed and cleared cookies across authentication redirects',()=>{
 const source=NextResponse.next()
 source.cookies.set('session','refreshed',{httpOnly:true,secure:true,sameSite:'lax',path:'/'})
 source.cookies.set('old-session','',{maxAge:0,path:'/'})
 const response=redirectWithSessionCookies(new URL('https://example.test/login'),source)
 expect(response.status).toBe(307)
 expect(response.headers.get('location')).toBe('https://example.test/login')
 expect(response.cookies.get('session')).toMatchObject({value:'refreshed',httpOnly:true,secure:true,sameSite:'lax',path:'/'})
 expect(response.cookies.get('old-session')).toMatchObject({value:'',maxAge:0})
})
it('does not treat unrelated routes sharing an auth prefix as public',()=>{
 expect(isPublicAuthPath('/login')).toBe(true);expect(isPublicAuthPath('/auth/confirm/')).toBe(true)
 expect(isPublicAuthPath('/login-admin')).toBe(false);expect(isPublicAuthPath('/auth/confirm/private')).toBe(false)
})
it('allows only the Excel task-pane documents through auth middleware, never its mutation APIs',()=>{
 expect(isPublicAuthPath('/integrations/excel')).toBe(true)
 expect(isPublicAuthPath('/integrations/excel/auth-complete')).toBe(true)
 expect(isPublicAuthPath('/api/integrations/excel/preview')).toBe(false)
 expect(isPublicAuthPath('/api/integrations/excel/check')).toBe(false)
})
