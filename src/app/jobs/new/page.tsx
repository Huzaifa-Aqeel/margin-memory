import { HistoricalOnboardingWorkspace } from '@/components/historical-onboarding-workspace'
import { isJobEligibleForTrustedMemory } from '@/lib/domain/memory-policy'
import { readStore } from '@/lib/repository/store'

export const dynamic = 'force-dynamic'

export default async function NewJobPage(){
  const store = await readStore()
  const ready = store.jobs.filter(isJobEligibleForTrustedMemory).length
  return <div className="page"><div className="page-head"><div><div className="eyebrow">Historical onboarding</div><h1>Build a useful comparison set</h1><p className="subtle">Start with 3–5 recent completed jobs similar to upcoming work. Margin Memory handles clerical interpretation; you confirm the commercial decisions that affect evidence.</p></div></div><HistoricalOnboardingWorkspace initialReadyCount={ready}/></div>
}
