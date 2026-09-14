import fs from 'node:fs'
import path from 'node:path'
const root=process.cwd();const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'))
const required=[
  'src/proxy.ts','src/lib/supabase/server.ts','src/lib/supabase/admin.ts','src/lib/supabase/proxy.ts','src/lib/repository/store.ts','src/lib/embeddings/index.ts','src/lib/agent/preflight.ts','src/lib/agent/tools.ts','src/lib/closeout.ts',
  'src/components/lifecycle-actions.tsx','src/app/login/page.tsx','src/app/onboarding/page.tsx','src/app/api/estimates/review/route.ts','src/app/api/jobs/import/route.ts',
  'src/app/api/estimates/[id]/lifecycle/route.ts','src/app/api/estimates/[id]/closeout/route.ts','src/app/api/finding-outcomes/[id]/confirm/route.ts',
  'supabase/migrations/202609100001_initial.sql','supabase/migrations/202609100002_transactional_imports.sql','supabase/migrations/202609100003_durable_investigations.sql','supabase/migrations/202609100004_tenant_integrity.sql','supabase/migrations/202609100005_closed_loop_lifecycle.sql'
]
const errors=[];for(const file of required)if(!fs.existsSync(path.join(root,file)))errors.push(`Missing ${file}`)
if(pkg.dependencies.next!=='16.3.4')errors.push(`Expected Next.js 16.3.4, found ${pkg.dependencies.next}`)
if(pkg.dependencies['@strands-agents/sdk']!=='1.17.0')errors.push('Expected Strands 1.17.0')
if(!pkg.dependencies['@supabase/supabase-js']||!pkg.dependencies['@supabase/ssr'])errors.push('Supabase dependencies missing')
const store=fs.readFileSync(path.join(root,'src/lib/repository/store.ts'),'utf8');if(store.includes('store.json')||store.includes('writeFile('))errors.push('Repository still contains local JSON persistence')
const docker=fs.readFileSync(path.join(root,'Dockerfile'),'utf8');if(/COPY .*data\/?/.test(docker))errors.push('Dockerfile still references prototype data directory')
const migration=required.filter(x=>x.endsWith('.sql')).map(x=>fs.readFileSync(path.join(root,x),'utf8')).join('\n');
for(const signal of ['enable row level security','extensions.vector(1536)','match_lessons','match_jobs','storage.objects','create_completed_job','persist_investigation_result','answer_estimator_question','job_estimate_lines_org_job_fk','lifecycle_status','transition_estimate_lifecycle','closeout_estimate_with_actuals','finding_outcomes','submission_findings','get_warning_calibration','estimates_lifecycle_guard','findings_freeze_guard'])if(!migration.toLowerCase().includes(signal.toLowerCase()))errors.push(`Migration missing ${signal}`)
const lifecycle=fs.readFileSync(path.join(root,'supabase/migrations/202609100005_closed_loop_lifecycle.sql'),'utf8')
for(const transition of ["draft' and p_to_stage='reviewed","reviewed' and p_to_stage='submitted","submitted' and p_to_stage='won","submitted' and p_to_stage='lost","won' and p_to_stage='in_progress","in_progress' and p_to_stage='completed"])if(!lifecycle.includes(transition))errors.push(`Lifecycle transition missing ${transition}`)
if(!lifecycle.includes("v_stage <> 'completed'"))errors.push('Closeout does not guard completed stage')
if(!lifecycle.includes('v_pending_lessons > 0 or v_pending_outcomes > 0'))errors.push('Learning completion does not guard pending verification')
for(const signal of ['closeout must evaluate every warning from the submitted preflight','job totals and variances are canonical database calculations','p_actor_user_id','grant execute on function public.begin_investigation(uuid,uuid,uuid,uuid) to service_role','revoke insert, update, delete on public.investigations from authenticated','submission_findings'])if(!lifecycle.toLowerCase().includes(signal.toLowerCase()))errors.push(`Lifecycle hardening missing ${signal}`)
if(store.includes("from('estimates').update"))errors.push('Repository still directly updates protected estimate state')
const admin=fs.readFileSync(path.join(root,'src/lib/supabase/admin.ts'),'utf8');if(!admin.includes('SUPABASE_SECRET_KEY')||admin.includes('NEXT_PUBLIC_SUPABASE_SECRET_KEY'))errors.push('Trusted server Supabase client is not isolated correctly')
const tools=fs.readFileSync(path.join(root,'src/lib/agent/tools.ts'),'utf8');if(!tools.includes("name:'get_warning_calibration'"))errors.push('Agent calibration tool missing')
if(errors.length){console.error(errors.join('\n'));process.exit(1)}
console.log('Production source verification passed.')
console.log(`Next.js ${pkg.dependencies.next}; Strands ${pkg.dependencies['@strands-agents/sdk']}; Supabase JS ${pkg.dependencies['@supabase/supabase-js']}`)
console.log('Closed-loop lifecycle, warning outcomes, and calibration are present.')
