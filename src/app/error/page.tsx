import Link from 'next/link'
export default function ErrorPage(){return <div className="auth-page"><div className="auth-card"><h1>We couldn’t complete that sign-in.</h1><p className="subtle">The link may have expired. Try signing in again or create a fresh account.</p><Link href="/login" className="btn primary">Back to sign in</Link></div></div>}
