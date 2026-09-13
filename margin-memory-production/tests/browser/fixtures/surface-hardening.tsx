import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MarginCheckStatus } from '../../../src/components/margin-check-status'
import { Badge, Metric } from '../../../src/components/ui'
import { presentMarginCheck, presentWarningEffectiveness, type MarginCheckPresentationState } from '../../../src/lib/domain/margin-check-presentation'

type View = 'dashboard' | 'estimates' | 'lessons' | MarginCheckPresentationState

const inputs = {
  queued: { investigationStatus: 'queued', findingCount: 0 },
  investigating: { investigationStatus: 'investigating', findingCount: 0 },
  needs_input: { investigationStatus: 'needs_input', findingCount: 0, unansweredQuestionCount: 1 },
  failed: { investigationStatus: 'failed', findingCount: 0 },
  findings: { investigationStatus: 'completed', findingCount: 1, openFindingCount: 1 },
  no_findings: { investigationStatus: 'completed', findingCount: 0 },
} as const

const stateLabels: Array<[MarginCheckPresentationState, string]> = [
  ['queued', 'Queued'],
  ['investigating', 'Running'],
  ['needs_input', 'Needs information'],
  ['failed', 'Failed'],
  ['findings', 'Findings'],
  ['no_findings', 'No findings'],
]

function PrimaryNavigation() {
  return <aside className="sidebar" style={{ position: 'static', minHeight: 700 }}>
    <div className="brand"><span className="brand-mark">M</span><span>Margin Memory</span></div>
    <nav className="nav" aria-label="Primary navigation">
      {['Dashboard', 'Estimates', 'Job history', 'Inbox'].map(label => <span className="nav-link" key={label}>{label}</span>)}
    </nav>
    <div className="secondary-nav"><div className="secondary-nav-label">Reference</div><span className="nav-link">Lessons</span></div>
    <div className="sidebar-foot">Margin Memory checks. You decide.</div>
  </aside>
}

function Dashboard() {
  const warning = presentWarningEffectiveness({ evaluable: 3, hitRate: 1 })
  return <main className="page" aria-label="Dashboard fixture"><div className="page-head"><div><div className="eyebrow">Estimating command center</div><h1>Catch the mistake before the job does.</h1><p className="subtle">Margin Check follows each estimate through its outcome.</p></div></div><div className="grid cols-4"><Metric label="Open findings" value="2" note="3 active estimates"/><Metric label="Active estimates" value="3" note="No closeout reviews waiting"/><Metric label="Historical evidence ready" value="7" note="4 verified production lessons"/><Metric label="Warning follow-up" value={warning.value} note={warning.note}/></div></main>
}

function Estimates() {
  return <main className="page" aria-label="Estimates fixture"><div className="page-head"><div><div className="eyebrow">Estimate review</div><h1>Estimates</h1><p className="subtle">Review current estimates before submission.</p></div></div><div className="table-wrap"><table><thead><tr><th>Estimate</th><th>Findings</th><th>Margin Check</th><th>Lifecycle</th></tr></thead><tbody><tr><td><strong>Occupied office renovation</strong></td><td>1</td><td><Badge tone="medium">1 open</Badge></td><td><Badge tone="neutral">draft</Badge></td></tr><tr><td><strong>Warehouse lighting</strong></td><td>0</td><td><Badge tone="confirmed">Review complete</Badge></td><td><Badge tone="medium">reviewed</Badge></td></tr></tbody></table></div></main>
}

function Lessons() {
  return <main className="page" aria-label="Lessons fixture"><div className="page-head"><div><div className="eyebrow">Company lessons</div><h1>Verified experience worth carrying forward</h1><p className="subtle">Confirmed lessons help Margin Check review future estimates.</p></div></div><div className="lesson"><Badge tone="confirmed">confirmed</Badge><h3>Occupied access changes labor productivity</h3><p><strong>Confirm access windows before carrying standard labor.</strong></p><div className="recommendation">Observed impact: labor exceeded the reviewed budget on comparable work.<br/><span className="helper">Source: Baker Office Renovation</span></div></div></main>
}

function EstimateState({ state }: { state: MarginCheckPresentationState }) {
  const presentation = presentMarginCheck(inputs[state])
  return <main className="page" aria-label={`Estimate detail ${state}`}><div className="page-head"><div><div className="eyebrow">Estimate lifecycle · office retrofit</div><h1>Riverside Office – Level 3</h1></div></div><section><div className="section-head"><h2>Margin Check findings</h2><span className="helper">Frozen once submitted</span></div><MarginCheckStatus presentation={presentation} action={state === 'failed' ? <button className="btn">Retry Margin Check</button> : undefined}/>{state === 'findings' && <article className="finding"><div className="finding-top"><div><Badge tone="medium">medium risk</Badge><h3>Labor deserves another look</h3></div></div><p><strong>Comparable completed jobs exceeded the reviewed labor budget.</strong></p><div className="rationale">Evidence strength: Moderate. The current job has a similar occupied-renovation profile.</div><div className="recommendation"><strong>Before submission</strong><br/>Confirm productivity and access assumptions.</div></article>}</section></main>
}

function Fixture() {
  const [view, setView] = useState<View>('dashboard')
  return <div><div className="actions fixture-switcher" aria-label="Surface views">
    <button onClick={() => setView('dashboard')}>Dashboard</button><button onClick={() => setView('estimates')}>Estimate list</button><button onClick={() => setView('lessons')}>Lessons</button>
    {stateLabels.map(([state, label]) => <button key={state} onClick={() => setView(state)}>{label}</button>)}
  </div><div className="fixture-shell"><PrimaryNavigation/>{view === 'dashboard' ? <Dashboard/> : view === 'estimates' ? <Estimates/> : view === 'lessons' ? <Lessons/> : <EstimateState state={view}/>}</div></div>
}

createRoot(document.getElementById('root')!).render(<Fixture/>)
