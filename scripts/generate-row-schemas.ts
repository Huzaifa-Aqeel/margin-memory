import {writeFileSync} from 'node:fs'
import {startDatabase} from '../tests/database/harness'
const database=await startDatabase()
try{
 const {rows}=await database.db.query<{table_name:string;column_name:string;udt_name:string;is_nullable:string}>("select table_name,column_name,udt_name,is_nullable from information_schema.columns where table_schema='public' order by table_name,ordinal_position")
 const category="z.enum(['labor','materials','equipment','subcontractor','permit','other'])"
 const overrides:Record<string,string>={
  'estimates.status':"z.enum(['draft','reviewing','needs_input','ready'])",
  'estimates.investigation_status':"z.enum(['queued','investigating','needs_input','completed','failed'])",
  'estimates.lifecycle_status':"z.enum(['draft','reviewed','submitted','won','lost','in_progress','completed','learning_review','learned'])",
  'estimates.agent_mode':"z.enum(['strands','deterministic'])",
  'estimates.agent_telemetry':"z.object({cycleCount:z.number(),toolsUsed:z.array(z.string()),totalDurationMs:z.number().optional()})",
  'findings.category':"z.enum(['labor','materials','equipment','subcontractor','permit','other','scope','assumption'])",
  'lessons.category':"z.enum(['labor','materials','equipment','subcontractor','permit','other','scope','assumption'])",
  'findings.status':"z.enum(['open','resolved','dismissed','superseded'])",
  'findings.severity':"z.enum(['low','medium','high'])",
  'lessons.status':"z.enum(['pending','confirmed','rejected'])",
  'finding_outcomes.system_verdict':"z.enum(['validated','partially_validated','not_observed','not_evaluable'])",
  'finding_outcomes.confirmed_verdict':"z.enum(['validated','partially_validated','not_observed','not_evaluable','mitigated'])",
  'finding_outcomes.confirmed_assessment':"outcomeAssessmentSchema",
  'finding_responses.kind':"z.enum(responseKinds)",
  'finding_responses.requested_status':"z.enum(['resolved','dismissed'])",
  'submission_findings.response_snapshot':"z.array(z.json())",
 }
 const tables=new Map<string,string[]>()
 for(const r of rows){let type=overrides[`${r.table_name}.${r.column_name}`]??(r.column_name==='category'?category:r.udt_name.startsWith('_')?'z.array(z.string())':['int4','int8','numeric','float8'].includes(r.udt_name)?'z.coerce.number().finite()':r.udt_name==='bool'?'z.boolean()':r.udt_name==='jsonb'?'z.json()':'z.string()');if(r.is_nullable==='YES')type+='.nullable()';tables.set(r.table_name,[...(tables.get(r.table_name)??[]),`  ${r.column_name}:${type},`])}
 writeFileSync('src/lib/repository/rows.ts',`// Generated from the migrated database by scripts/generate-row-schemas.ts.\nimport {z} from 'zod'\nimport { outcomeAssessmentSchema, responseKinds } from '@/lib/domain/warning-response'\nexport const rows={\n${[...tables].map(([name,fields])=>`${name}:z.object({\n${fields.join('\n')}\n}),`).join('\n')}\n}\n`)
}finally{await database.stop()}
