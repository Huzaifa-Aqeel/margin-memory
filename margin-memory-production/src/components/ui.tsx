import type { ReactNode } from 'react'
import type { RiskSeverity } from '@/lib/domain/types'

export function Badge({ children, tone='neutral' }: { children:ReactNode; tone?:RiskSeverity|'ready'|'neutral'|'confirmed'|'pending' }) {
  return <span className={`badge ${tone}`}><span className="dot"/>{children}</span>
}

export function Metric({ label, value, note }: { label:string; value:string; note?:string }) {
  return <div className="card"><div className="metric-label">{label}</div><div className="metric-value">{value}</div>{note && <div className="metric-note">{note}</div>}</div>
}
