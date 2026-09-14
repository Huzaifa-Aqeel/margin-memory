'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Archive, BookOpen, ClipboardCheck, FilePlus2, Inbox, LayoutDashboard, LogOut } from 'lucide-react'
import type { ReactNode } from 'react'
import { logoutAction } from '@/app/actions/auth'

const nav=[{href:'/',label:'Dashboard',icon:LayoutDashboard},{href:'/preflight',label:'Estimates',icon:ClipboardCheck},{href:'/jobs',label:'Job history',icon:Archive},{href:'/inbox',label:'Inbox',icon:Inbox}]
const lessons={href:'/memory',label:'Lessons',icon:BookOpen}
const bare=['/login','/signup','/onboarding','/error','/auth/','/integrations/excel']

export function AppShell({children}:{children:ReactNode}){
  const pathname=usePathname();if(bare.some(p=>pathname===p||pathname.startsWith(p)))return <>{children}</>
  const active=(href:string)=>href==='/'?pathname==='/':pathname.startsWith(href)||(href==='/preflight'&&pathname.startsWith('/estimates'))
  const LessonsIcon=lessons.icon
  return <div className="app-shell"><aside className="sidebar"><Link href="/" className="brand"><span className="brand-mark">M</span><span>Margin Memory</span></Link><nav className="nav">{nav.map(item=>{const Icon=item.icon;return <Link key={item.href} href={item.href} className={`nav-link ${active(item.href)?'active':''}`}><Icon size={18}/>{item.label}</Link>})}</nav><div style={{marginTop:16}}><Link href="/estimates/new" className="btn primary" style={{width:'100%'}}><FilePlus2 size={16}/>Review estimate</Link></div><div className="secondary-nav"><div className="secondary-nav-label">Reference</div><Link href={lessons.href} className={`nav-link ${pathname.startsWith(lessons.href)?'active':''}`}><LessonsIcon size={17}/>{lessons.label}</Link></div><div className="sidebar-foot"><div>Margin Memory checks. You decide.</div><form action={logoutAction}><button className="logout-button" type="submit"><LogOut size={14}/>Sign out</button></form></div></aside><main className="main"><div className="topbar"><span className="subtle"><span className="status-dot"/>Private company workspace</span></div><div className="mobile-top"><Link href="/" className="brand"><span className="brand-mark">M</span><span>Margin Memory</span></Link><Link href="/estimates/new" className="btn small primary">Review</Link></div>{children}</main><nav className="mobile-nav">{nav.map(item=>{const Icon=item.icon;return <Link key={item.href} href={item.href} className={active(item.href)?'active':''}><Icon size={18}/>{item.label.split(' ')[0]}</Link>})}</nav></div>
}
