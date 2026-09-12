import 'server-only'
import {z} from 'zod'
import {seedStore} from '@/lib/seed'
import {id} from '@/lib/domain/ids'
import {unknownScope} from '@/lib/domain/scope'
import {createAdminClient} from '@/lib/supabase/admin'
import {getCurrentWorkspace} from './workspace'

export const DEMO_DATASET_VERSION='margin-memory-demo-v1'
const resultSchema=z.object({estimateId:z.string().uuid(),jobs:z.coerce.number().int().nonnegative(),lessons:z.coerce.number().int().nonnegative(),status:z.enum(['preflight_pending','preflight_running','preflight_failed','complete']),reused:z.boolean()})
const claimSchema=z.object({claimed:z.boolean(),status:z.enum(['preflight_running','complete']),estimateId:z.string().uuid(),leaseToken:z.string().uuid().nullable()})
async function demoContext(){const context=await getCurrentWorkspace();if(!context.userId||!context.workspace)throw new Error('Authentication/workspace required');return{workspace:context.workspace,userId:context.userId}}

const estimateLines=(lines:typeof seedStore.estimates[number]['lines'])=>lines.map(line=>({id:id(),category:line.category,description:line.description,quantity:line.quantity??null,unit:line.unit??null,normalized_unit:line.normalizedUnit??null,unit_cost:line.unitCost??null,cost_code:line.costCode??null,phase:line.phase??null,division:line.division??null,estimated_hours:line.estimatedHours??null,estimated_cost:line.estimatedCost}))
const actualLines=(lines:typeof seedStore.jobs[number]['actualLines'])=>lines.map(line=>({id:id(),category:line.category,description:line.description,quantity:line.quantity??null,unit:line.unit??null,normalized_unit:line.normalizedUnit??null,unit_cost:line.unitCost??null,cost_code:line.costCode??null,phase:line.phase??null,division:line.division??null,actual_hours:line.actualHours??null,actual_cost:line.actualCost}))

export async function ensureDemoWorkspace(){
 const{workspace,userId}=await demoContext();const admin=createAdminClient()
 const jobs=seedStore.jobs.map(source=>{const jobId=id();return{job:{id:jobId,scope_review:source.scopeReview??unknownScope,name:source.name,project_type:source.projectType,customer_type:source.customerType,location:source.location,completed_at:source.completedAt,tags:source.tags,notes:source.notes,gross_margin_pct:source.grossMarginPct??null,estimate_baseline_role:'historical_unknown',data_origin:'demo'},estimate_lines:estimateLines(source.estimateLines),actual_lines:actualLines(source.actualLines),variances:source.variances.map(value=>({category:value.category,estimated_cost:value.estimatedCost,actual_cost:value.actualCost,estimated_hours:value.estimatedHours,actual_hours:value.actualHours,cost_delta:value.costDelta,cost_delta_pct:value.costDeltaPct,hours_delta:value.hoursDelta,hours_delta_pct:value.hoursDeltaPct})),lessons:seedStore.lessons.filter(lesson=>lesson.jobId===source.id).map(lesson=>({id:id(),title:lesson.title,category:lesson.category,lesson:lesson.lesson,cause:lesson.cause,impact_summary:lesson.impactSummary,confidence:lesson.confidence,status:lesson.status,created_at:new Date().toISOString()}))}})
 const source=seedStore.estimates[0];if(!source)throw new Error('Demo estimate fixture is missing')
 const estimate={estimate:{id:id(),name:source.name,project_type:source.projectType,customer_type:source.customerType,location:source.location,bid_due:source.bidDue??'',tags:source.tags,assumptions:source.assumptions,created_at:new Date().toISOString(),baseline_role:'original_bid',data_origin:'demo'},lines:estimateLines(source.lines)}
 const{data,error}=await admin.rpc('seed_demo_workspace_server',{p_organization_id:workspace.id,p_actor_user_id:userId,p_dataset_version:DEMO_DATASET_VERSION,p_jobs:jobs,p_estimate:estimate});if(error)throw error
 return resultSchema.parse(data)
}

export async function claimDemoPreflight(){const{workspace,userId}=await demoContext();const admin=createAdminClient();const{data,error}=await admin.rpc('claim_demo_preflight_server',{p_organization_id:workspace.id,p_actor_user_id:userId,p_dataset_version:DEMO_DATASET_VERSION});if(error)throw error;return claimSchema.parse(data)}

export async function finishDemoSeed(args:{leaseToken:string;succeeded:boolean;error?:string}){const{workspace,userId}=await demoContext();const admin=createAdminClient();const{error}=await admin.rpc('finish_demo_seed_server',{p_organization_id:workspace.id,p_actor_user_id:userId,p_dataset_version:DEMO_DATASET_VERSION,p_lease_token:args.leaseToken,p_succeeded:args.succeeded,p_error:args.error??null});if(error)throw error}

export async function resetDemoWorkspace(){const{workspace,userId}=await demoContext();const admin=createAdminClient();const{data,error}=await admin.rpc('reset_demo_workspace_server',{p_organization_id:workspace.id,p_actor_user_id:userId});if(error)throw error;return z.object({jobs:z.coerce.number().int().nonnegative(),estimates:z.coerce.number().int().nonnegative()}).parse(data)}
