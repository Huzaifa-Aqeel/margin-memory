import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Clock3, LoaderCircle } from 'lucide-react'
import type { MarginCheckPresentation } from '@/lib/domain/margin-check-presentation'
import { Badge } from './ui'

const icons = {
  queued: Clock3,
  investigating: LoaderCircle,
  needs_input: AlertTriangle,
  failed: AlertTriangle,
  findings: AlertTriangle,
  no_findings: CheckCircle2,
}

export function MarginCheckStatus({ presentation, action }: { presentation: MarginCheckPresentation; action?: ReactNode }) {
  const Icon = icons[presentation.state]
  return <div className={`card margin-check-status ${presentation.state}`} aria-label="Margin Check status" data-margin-check-state={presentation.state}>
    <div className="margin-check-status-icon"><Icon className={presentation.state === 'investigating' ? 'spin' : undefined} size={25}/></div>
    <div>
      <Badge tone={presentation.tone}>{presentation.label}</Badge>
      <h2>{presentation.title}</h2>
      <p>{presentation.description}</p>
      {action}
    </div>
  </div>
}
