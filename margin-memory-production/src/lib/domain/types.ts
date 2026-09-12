import type { ScopeReview } from './scope'
import type { OutcomeAssessment, WarningResponse } from './warning-response'
export type RiskSeverity = 'low' | 'medium' | 'high'
export type FindingStatus = 'open' | 'resolved' | 'dismissed' | 'superseded'
export type LessonStatus = 'pending' | 'confirmed' | 'rejected'
export type InvestigationStatus = 'queued' | 'investigating' | 'needs_input' | 'completed' | 'failed'
export type LifecycleStatus = 'draft' | 'reviewed' | 'submitted' | 'won' | 'lost' | 'in_progress' | 'completed' | 'learning_review' | 'learned'
export type FindingOutcomeVerdict = 'validated' | 'partially_validated' | 'not_observed' | 'not_evaluable' | 'mitigated'

export type CostCategory =
  | 'labor'
  | 'materials'
  | 'equipment'
  | 'subcontractor'
  | 'permit'
  | 'other'

export interface EstimateLine {
  id: string
  category: CostCategory
  description: string
  quantity?: number
  unit?: string
  normalizedUnit?: string
  unitCost?: number
  costCode?: string
  phase?: string
  division?: string
  estimatedHours?: number
  estimatedCost: number
}

export interface ActualLine {
  id: string
  category: CostCategory
  description: string
  quantity?: number
  unit?: string
  normalizedUnit?: string
  unitCost?: number
  costCode?: string
  phase?: string
  division?: string
  actualHours?: number
  actualCost: number
}

export interface Variance {
  category: CostCategory
  estimatedCost: number
  actualCost: number
  estimatedHours: number
  actualHours: number
  costDelta: number
  costDeltaPct: number | null
  hoursDelta: number
  hoursDeltaPct: number | null
}

export interface Job {
  id: string
  scopeReview?: ScopeReview
  sourceEstimateId?: string
  contractValue?: number
  name: string
  projectType: string
  customerType: string
  location: string
  completedAt: string
  tags: string[]
  notes: string
  estimateLines: EstimateLine[]
  actualLines: ActualLine[]
  variances: Variance[]
  estimatedTotal: number
  actualTotal: number
  grossMarginPct?: number
  estimateBaselineRole?: 'original_bid' | 'final_submitted' | 'historical_unknown'
  dataOrigin?: 'production' | 'demo' | 'synthetic_test'
  memoryStatus?: 'trusted' | 'quarantined'
  memoryQuarantineReason?: string
  memoryQuarantinedAt?: string
}

export interface Lesson {
  id: string
  jobId: string
  title: string
  category: CostCategory | 'scope' | 'assumption'
  lesson: string
  cause: string
  impactSummary: string
  confidence: number
  status: LessonStatus
  createdAt: string
}

export interface FindingEvidence {
  jobId: string
  label: string
  detail: string
}

export interface Finding {
  id: string
  responses?: WarningResponse[]
  estimateId: string
  category: CostCategory | 'scope' | 'assumption'
  severity: RiskSeverity
  title: string
  claim: string
  rationale: string
  recommendation: string
  question?: string
  evidence: FindingEvidence[]
  confidence: number
  status: FindingStatus
  createdAt: string
}

export interface FindingOutcome {
  id: string
  assessment?: OutcomeAssessment
  estimateId: string
  findingId: string
  jobId: string
  systemVerdict: FindingOutcomeVerdict
  confirmedVerdict?: FindingOutcomeVerdict
  explanation: string
  evidenceSummary: string
  confidence: number
  confirmedAt?: string
}

export interface HumanQuestion {
  id: string
  estimateId: string
  prompt: string
  context: string
  options: string[]
  answer?: string
  resolvedAt?: string
}

export interface AgentTelemetry {
  cycleCount: number
  toolsUsed: string[]
  totalDurationMs?: number
}

export interface Estimate {
  id: string
  name: string
  projectType: string
  customerType: string
  location: string
  bidDue?: string
  tags: string[]
  assumptions: string[]
  lines: EstimateLine[]
  estimatedTotal: number
  estimatedLaborHours: number
  createdAt: string
  status: 'draft' | 'reviewing' | 'needs_input' | 'ready'
  investigationStatus: InvestigationStatus
  lifecycleStatus: LifecycleStatus
  submittedAt?: string
  submittedAmount?: number
  wonAt?: string
  lostAt?: string
  lostReason?: string
  contractValue?: number
  startedAt?: string
  completedAt?: string
  actualsImportedAt?: string
  learnedAt?: string
  closeoutNotes?: string
  linkedJobId?: string
  findings: Finding[]
  submittedFindingIds: string[]
  findingOutcomes: FindingOutcome[]
  questions: HumanQuestion[]
  agentSummary?: string
  agentMode?: 'strands' | 'deterministic'
  agentTelemetry?: AgentTelemetry
  reviewedAt?: string
  revisionGroupId?: string
  parentEstimateId?: string
  revisionNumber?: number
  baselineRole?: 'original_bid' | 'revision' | 'final_submitted' | 'historical_unknown'
  dataOrigin?: 'production' | 'demo' | 'synthetic_test'
}

export interface Store {
  jobs: Job[]
  lessons: Lesson[]
  estimates: Estimate[]
}
