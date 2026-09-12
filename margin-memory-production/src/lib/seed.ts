import { calculateVariances, sumActual, sumEstimate } from './domain/analytics'
import type { ActualLine, CostCategory, Estimate, EstimateLine, Job, Lesson, Store } from './domain/types'

function e(id: string, category: CostCategory, description: string, estimatedCost: number, estimatedHours = 0): EstimateLine {
  return { id, category, description, estimatedCost, estimatedHours }
}
function a(id: string, category: CostCategory, description: string, actualCost: number, actualHours = 0): ActualLine {
  return { id, category, description, actualCost, actualHours }
}
function job(input: Omit<Job, 'variances' | 'estimatedTotal' | 'actualTotal'>): Job {
  return {
    scopeReview: {status: 'no_changes', changes: [], actualCompleteness:'confirmed_complete'},
    ...input,
    variances: calculateVariances(input.estimateLines, input.actualLines),
    estimatedTotal: sumEstimate(input.estimateLines),
    actualTotal: sumActual(input.actualLines),
  }
}

const jobs: Job[] = [
  job({
    id: 'job_baker', name: 'Baker Office Renovation', projectType: 'Office retrofit', customerType: 'Commercial', location: 'Philadelphia, PA', completedAt: '2026-06-18', tags: ['occupied', 'retrofit', 'conduit-reuse'],
    notes: 'Occupied office. Existing conduit looked reusable during walkthrough, but several pathways above the west offices were packed. Restricted ceiling access slowed rough-in and required new conduit runs.', grossMarginPct: 0.14,
    estimateLines: [e('be1','labor','Rough-in and branch wiring',8400,112),e('be2','materials','Wire, fittings, devices',11400),e('be3','equipment','Small tools and access',700),e('be4','permit','Permit allowance',900)],
    actualLines: [a('ba1','labor','Rough-in and branch wiring',11025,147),a('ba2','materials','Wire, fittings, devices',12920),a('ba3','equipment','Lift rental and access',2450),a('ba4','permit','Permit',900)],
  }),
  job({
    id: 'job_delta', name: 'Delta Dental TI', projectType: 'Office retrofit', customerType: 'Commercial', location: 'Cherry Hill, NJ', completedAt: '2026-04-02', tags: ['occupied', 'retrofit', 'after-hours'],
    notes: 'Client stayed operational during construction. Access windows were shorter than assumed and several shutdowns moved to evenings. Labor productivity suffered and overtime was added.', grossMarginPct: 0.18,
    estimateLines: [e('de1','labor','Tenant improvement electrical labor',9600,128),e('de2','materials','Branch wiring and devices',14200),e('de3','equipment','Access equipment',1200),e('de4','permit','Permit',1100)],
    actualLines: [a('da1','labor','Tenant improvement electrical labor',11475,153),a('da2','materials','Branch wiring and devices',14680),a('da3','equipment','Access equipment',1850),a('da4','permit','Permit',1100)],
  }),
  job({
    scopeReview: {status:'adjusted',actualCompleteness:'confirmed_complete',changes:[{reference:'DEMO-CO-1',description:'Approved fixture upgrade',category:'materials',estimatedCost:4700,estimatedHours:0,actualCost:4700,actualHours:0}]},
    id: 'job_ford', name: 'Ford Street Retail Refresh', projectType: 'Retail retrofit', customerType: 'Commercial', location: 'Wilmington, DE', completedAt: '2026-01-27', tags: ['retrofit', 'night-work', 'fixtures'],
    notes: 'Lighting package changed after bid. Supplier quote used during estimate did not include revised decorative fixtures. Night work was planned correctly.', grossMarginPct: 0.19,
    estimateLines: [e('fe1','labor','Retail retrofit labor',7200,96),e('fe2','materials','Lighting fixtures and devices',18400),e('fe3','equipment','Lift rental',1600),e('fe4','permit','Permit',750)],
    actualLines: [a('fa1','labor','Retail retrofit labor',7500,100),a('fa2','materials','Lighting fixtures and devices',23100),a('fa3','equipment','Lift rental',1600),a('fa4','permit','Permit',750)],
  }),
  job({
    id: 'job_maple', name: 'Maple Apartments Common Areas', projectType: 'Multifamily retrofit', customerType: 'Commercial', location: 'Camden, NJ', completedAt: '2025-11-14', tags: ['1970s', 'retrofit', 'occupied', 'conduit-reuse'],
    notes: 'Older building conditions were worse than drawings indicated. Existing conduit reuse failed in two risers and access above corridor ceilings was limited.', grossMarginPct: 0.11,
    estimateLines: [e('me1','labor','Common area retrofit labor',13500,180),e('me2','materials','Feeders, conduit, devices',20600),e('me3','equipment','Lift allowance',1200),e('me4','permit','Permit',1400)],
    actualLines: [a('ma1','labor','Common area retrofit labor',17850,238),a('ma2','materials','Feeders, conduit, devices',23400),a('ma3','equipment','Lift allowance',2900),a('ma4','permit','Permit',1400)],
  }),
  job({
    id: 'job_union', name: 'Union Bank Branch', projectType: 'Office retrofit', customerType: 'Commercial', location: 'Princeton, NJ', completedAt: '2025-09-09', tags: ['retrofit', 'after-hours', 'security'],
    notes: 'Good preconstruction walk. Access and shutdown constraints were confirmed in writing before bid. Labor finished nearly on estimate.', grossMarginPct: 0.29,
    estimateLines: [e('ue1','labor','Branch renovation labor',10500,140),e('ue2','materials','Power, lighting, controls',16900),e('ue3','equipment','Access equipment',950),e('ue4','permit','Permit',1250)],
    actualLines: [a('ua1','labor','Branch renovation labor',10950,146),a('ua2','materials','Power, lighting, controls',16600),a('ua3','equipment','Access equipment',950),a('ua4','permit','Permit',1250)],
  }),
  job({
    scopeReview: {status:'adjusted',actualCompleteness:'confirmed_complete',changes:[{reference:'DEMO-CO-2',description:'Approved infection-control work',category:'labor',estimatedCost:1800,estimatedHours:24,actualCost:1800,actualHours:24}]},
    id: 'job_harbor', name: 'Harbor Medical Suite', projectType: 'Office retrofit', customerType: 'Commercial', location: 'Newark, DE', completedAt: '2025-07-22', tags: ['medical', 'retrofit', 'occupied'],
    notes: 'Ceiling access was confirmed before bid, but owner added infection-control restrictions after award. Added mobilization and cleanup time.', grossMarginPct: 0.21,
    estimateLines: [e('he1','labor','Medical office retrofit labor',12750,170),e('he2','materials','Devices, wiring, panels',22400),e('he3','equipment','Access equipment',1500),e('he4','permit','Permit',1350)],
    actualLines: [a('ha1','labor','Medical office retrofit labor',14550,194),a('ha2','materials','Devices, wiring, panels',22800),a('ha3','equipment','Access equipment',1500),a('ha4','permit','Permit',1350)],
  }),
  job({
    id: 'job_ridge', name: 'Ridge Warehouse Lighting', projectType: 'Warehouse lighting', customerType: 'Commercial', location: 'New Castle, DE', completedAt: '2025-05-31', tags: ['warehouse', 'lift', 'fixtures'],
    notes: 'Fixture package and lift heights were fully confirmed. Crew productivity exceeded estimate.', grossMarginPct: 0.34,
    estimateLines: [e('re1','labor','High-bay lighting replacement',9000,120),e('re2','materials','High-bay fixtures',28600),e('re3','equipment','40ft lift rental',3200),e('re4','permit','Permit',650)],
    actualLines: [a('ra1','labor','High-bay lighting replacement',8250,110),a('ra2','materials','High-bay fixtures',27900),a('ra3','equipment','40ft lift rental',3200),a('ra4','permit','Permit',650)],
  }),
  job({
    id: 'job_oak', name: 'Oak Street Restaurant', projectType: 'Restaurant fit-out', customerType: 'Commercial', location: 'Philadelphia, PA', completedAt: '2025-02-11', tags: ['fit-out', 'kitchen', 'service-upgrade'],
    notes: 'Utility service coordination took longer than expected. Permit fees were accurate. Kitchen equipment connections were well scoped.', grossMarginPct: 0.24,
    estimateLines: [e('oe1','labor','Restaurant fit-out labor',11250,150),e('oe2','materials','Panels, feeders, devices',19800),e('oe3','equipment','Access equipment',900),e('oe4','permit','Permit',1800)],
    actualLines: [a('oa1','labor','Restaurant fit-out labor',12375,165),a('oa2','materials','Panels, feeders, devices',20100),a('oa3','equipment','Access equipment',900),a('oa4','permit','Permit',1800)],
  }),
]

const lessons: Lesson[] = [
  { id: 'lesson_conduit', jobId: 'job_baker', title: 'Verify conduit before carrying reuse', category: 'assumption', lesson: 'On occupied office retrofits, do not rely on visual conduit reuse assumptions. Confirm pathway capacity or carry new conduit labor.', cause: 'Existing pathways were packed and unusable.', impactSummary: '+35 labor hours and added conduit material.', confidence: 0.96, status: 'confirmed', createdAt: '2026-06-19' },
  { id: 'lesson_access', jobId: 'job_delta', title: 'Occupied access reduces productive hours', category: 'labor', lesson: 'When a client remains operational, confirm work windows and shutdown rules before using normal labor productivity.', cause: 'Short work windows and evening shutdowns.', impactSummary: '+25 labor hours.', confidence: 0.94, status: 'confirmed', createdAt: '2026-04-03' },
  { id: 'lesson_oldbuilding', jobId: 'job_maple', title: 'Older retrofit drawings hide pathway risk', category: 'scope', lesson: 'For older multifamily retrofits, treat existing pathway condition as a material unknown unless verified onsite.', cause: 'Two existing risers could not be reused.', impactSummary: '+58 labor hours and +$4,500 combined material/equipment.', confidence: 0.93, status: 'confirmed', createdAt: '2025-11-15' },
]

const estimates: Estimate[] = [
  {
    id: 'est_riverside', name: 'Riverside Office – Level 3', projectType: 'Office retrofit', customerType: 'Commercial', location: 'Philadelphia, PA', bidDue: '2026-09-11', tags: ['occupied','retrofit','conduit-reuse'],
    assumptions: ['Existing conduit can be reused where accessible', 'Normal daytime access to work areas', 'Lighting quote reflects current schedule'],
    lines: [e('rv1','labor','Level 3 electrical retrofit labor',8850,118),e('rv2','materials','Wire, devices and lighting',24400),e('rv3','equipment','Access equipment allowance',900),e('rv4','permit','Permit allowance',1000)],
    estimatedTotal: 35150, estimatedLaborHours: 118, createdAt: '2026-09-10T08:00:00.000Z', status: 'needs_input', investigationStatus: 'needs_input', lifecycleStatus:'draft', submittedFindingIds:[], findingOutcomes:[], agentMode: 'deterministic', reviewedAt: '2026-09-10T08:05:00.000Z',
    agentSummary: 'Two historical patterns deserve attention before this bid goes out: conduit reuse and occupied-area labor productivity.',
    findings: [
      { id:'find_conduit', estimateId:'est_riverside', category:'assumption', severity:'high', title:'Existing conduit reuse is not verified', claim:'This estimate repeats an assumption that previously caused material labor overruns.', rationale:'Baker Office and Maple Apartments both carried conduit reuse that failed in the field.', recommendation:'Confirm existing pathway capacity onsite or explicitly carry new conduit labor and material.', question:'Has existing conduit capacity been inspected and confirmed?', evidence:[{jobId:'job_baker',label:'Baker Office Renovation',detail:'+35 labor hours; existing pathways were packed.'},{jobId:'job_maple',label:'Maple Apartments Common Areas',detail:'+58 labor hours; two risers could not be reused.'}], confidence:0.94,status:'open',createdAt:'2026-09-10T08:05:00.000Z' },
      { id:'find_access', estimateId:'est_riverside', category:'labor', severity:'medium', title:'Normal-access labor assumption looks optimistic', claim:'Comparable occupied office retrofits frequently exceeded planned labor.', rationale:'Four office retrofit jobs with similar access constraints had a median labor overrun of roughly 16%.', recommendation:'Confirm working hours, shutdown windows, and occupied-area restrictions before final review.', question:'Will all work areas be available during normal working hours?', evidence:[{jobId:'job_delta',label:'Delta Dental TI',detail:'+25 labor hours because access windows moved work into evenings.'},{jobId:'job_harbor',label:'Harbor Medical Suite',detail:'+24 labor hours after additional operating restrictions.'}], confidence:0.84,status:'open',createdAt:'2026-09-10T08:05:00.000Z' }
    ],
    questions: [{ id:'q_riverside_access', estimateId:'est_riverside', prompt:'Will all work areas be available during normal working hours?', context:'The agent found repeated labor overruns on occupied office retrofits when access windows were constrained.', options:['Yes — confirmed','No — restricted access','Not sure yet'] }]
  },
  {
    id: 'est_greenwood', name: 'Greenwood Warehouse LEDs', projectType: 'Warehouse lighting', customerType: 'Commercial', location: 'New Castle, DE', bidDue: '2026-09-15', tags: ['warehouse','lift','fixtures'], assumptions: ['40ft lift is sufficient', 'Fixture quote dated September 8 is current'],
    lines: [e('gw1','labor','High-bay fixture replacement',9300,124),e('gw2','materials','LED fixtures',29800),e('gw3','equipment','40ft lift',3400),e('gw4','permit','Permit',700)], estimatedTotal:43200, estimatedLaborHours:124, createdAt:'2026-09-09T15:00:00.000Z', status:'ready', investigationStatus:'completed', lifecycleStatus:'draft', submittedFindingIds:[], findingOutcomes:[], agentMode:'deterministic', reviewedAt:'2026-09-09T15:04:00.000Z', agentSummary:'No material historical risks found. The closest completed warehouse job finished under planned labor with the same lift class.', findings:[], questions:[]
  }
]

export const seedStore: Store = { jobs, lessons, estimates }
