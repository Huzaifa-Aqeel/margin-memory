import Link from 'next/link'
import { loginAction } from '@/app/actions/auth'

export default async function LoginPage({searchParams}:{searchParams:Promise<{error?:string;message?:string;next?:string}>}){
  const p=await searchParams
  return <div className="auth-page"><div className="auth-card"><div className="auth-brand"><span className="brand-mark">M</span><div><strong>Margin Memory</strong><span>Estimating judgment, remembered.</span></div></div><h1>Sign in</h1><p className="subtle">Review bids against what actually happened on your previous jobs.</p>{p.error&&<div className="error">{p.error}</div>}{p.message&&<div className="success">{p.message}</div>}<form action={loginAction} className="auth-form"><input type="hidden" name="next" value={p.next||'/'}/><div className="field"><label>Email</label><input type="email" name="email" autoComplete="email" required/></div><div className="field"><label>Password</label><input type="password" name="password" autoComplete="current-password" required/></div><button className="btn primary" type="submit">Sign in</button></form><div className="auth-switch">New to Margin Memory? <Link href="/signup"><strong>Create an account</strong></Link></div></div></div>
}
