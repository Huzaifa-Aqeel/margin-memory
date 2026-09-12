-- Durable, atomic human-in-the-loop investigation state.
-- All functions are SECURITY INVOKER so table RLS remains the authorization boundary.

create or replace function public.begin_investigation(
  p_organization_id uuid,
  p_estimate_id uuid,
  p_investigation_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.investigations(id, organization_id, estimate_id, status)
  values (p_investigation_id, p_organization_id, p_estimate_id, 'investigating');

  update public.estimates
  set status = 'reviewing', investigation_status = 'investigating'
  where id = p_estimate_id and organization_id = p_organization_id;

  if not found then
    raise exception 'estimate not found';
  end if;

  return p_investigation_id;
end;
$$;

create or replace function public.answer_estimator_question(
  p_organization_id uuid,
  p_estimate_id uuid,
  p_question_id uuid,
  p_answer text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_prompt text;
begin
  if char_length(trim(coalesce(p_answer, ''))) = 0 then
    raise exception 'answer is required';
  end if;

  update public.human_questions
  set answer = trim(p_answer), resolved_at = now()
  where id = p_question_id
    and estimate_id = p_estimate_id
    and organization_id = p_organization_id
    and resolved_at is null
  returning prompt into v_prompt;

  if v_prompt is null then
    raise exception 'question not found or already resolved';
  end if;

  update public.estimates
  set assumptions = array_append(
        assumptions,
        format('Estimator response to "%s": %s', v_prompt, trim(p_answer))
      ),
      status = 'reviewing',
      investigation_status = 'queued'
  where id = p_estimate_id and organization_id = p_organization_id;

  if not found then
    raise exception 'estimate not found';
  end if;
end;
$$;

create or replace function public.persist_investigation_result(
  p_organization_id uuid,
  p_estimate_id uuid,
  p_investigation_id uuid,
  p_summary text,
  p_mode text,
  p_telemetry jsonb,
  p_findings jsonb,
  p_questions jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  f jsonb;
  e jsonb;
  q jsonb;
  v_finding_id uuid;
  v_estimate_status text;
  v_investigation_status text;
  v_cycle_count integer := coalesce((p_telemetry->>'cycleCount')::integer, 0);
  v_tools_used text[] := coalesce(array(select jsonb_array_elements_text(coalesce(p_telemetry->'toolsUsed', '[]'::jsonb))), '{}');
  v_duration integer := nullif(p_telemetry->>'totalDurationMs', '')::integer;
begin
  if p_mode not in ('strands', 'deterministic') then
    raise exception 'invalid agent mode';
  end if;

  -- Preserve resolved/dismissed history; atomically replace only active review work.
  delete from public.findings
  where organization_id = p_organization_id
    and estimate_id = p_estimate_id
    and status = 'open';

  delete from public.human_questions
  where organization_id = p_organization_id
    and estimate_id = p_estimate_id
    and resolved_at is null;

  for f in select value from jsonb_array_elements(coalesce(p_findings, '[]'::jsonb)) loop
    v_finding_id := (f->>'id')::uuid;
    insert into public.findings(
      id, organization_id, estimate_id, investigation_id,
      category, severity, title, claim, rationale, recommendation,
      question, confidence, status, created_at
    ) values (
      v_finding_id, p_organization_id, p_estimate_id, p_investigation_id,
      f->>'category', f->>'severity', f->>'title', f->>'claim',
      f->>'rationale', f->>'recommendation', nullif(f->>'question', ''),
      coalesce((f->>'confidence')::numeric, 0.5), 'open', now()
    );

    for e in select value from jsonb_array_elements(coalesce(f->'evidence', '[]'::jsonb)) loop
      insert into public.finding_evidence(
        organization_id, finding_id, job_id, label, detail
      ) values (
        p_organization_id, v_finding_id, (e->>'jobId')::uuid,
        e->>'label', e->>'detail'
      );
    end loop;
  end loop;

  for q in select value from jsonb_array_elements(coalesce(p_questions, '[]'::jsonb)) loop
    insert into public.human_questions(
      id, organization_id, estimate_id, investigation_id,
      prompt, context, options
    ) values (
      (q->>'id')::uuid, p_organization_id, p_estimate_id, p_investigation_id,
      q->>'prompt', coalesce(q->>'context', ''),
      coalesce(array(select jsonb_array_elements_text(coalesce(q->'options', '[]'::jsonb))), '{}')
    );
  end loop;

  v_estimate_status := case
    when jsonb_array_length(coalesce(p_findings, '[]'::jsonb)) > 0
      or jsonb_array_length(coalesce(p_questions, '[]'::jsonb)) > 0
    then 'needs_input'
    else 'ready'
  end;

  v_investigation_status := case
    when jsonb_array_length(coalesce(p_questions, '[]'::jsonb)) > 0 then 'needs_input'
    else 'completed'
  end;

  update public.investigations
  set status = v_investigation_status,
      mode = p_mode,
      summary = p_summary,
      cycle_count = v_cycle_count,
      tools_used = v_tools_used,
      total_duration_ms = v_duration,
      error = null,
      completed_at = now()
  where id = p_investigation_id
    and estimate_id = p_estimate_id
    and organization_id = p_organization_id;

  if not found then
    raise exception 'investigation not found';
  end if;

  update public.estimates
  set status = v_estimate_status,
      investigation_status = v_investigation_status,
      agent_summary = p_summary,
      agent_mode = p_mode,
      agent_telemetry = coalesce(p_telemetry, '{"cycleCount":0,"toolsUsed":[]}'::jsonb),
      reviewed_at = now()
  where id = p_estimate_id and organization_id = p_organization_id;

  if not found then
    raise exception 'estimate not found';
  end if;
end;
$$;

create or replace function public.fail_investigation(
  p_organization_id uuid,
  p_estimate_id uuid,
  p_investigation_id uuid,
  p_error text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.investigations
  set status = 'failed', error = left(coalesce(p_error, 'unknown error'), 2000), completed_at = now()
  where id = p_investigation_id
    and estimate_id = p_estimate_id
    and organization_id = p_organization_id;

  update public.estimates
  set status = 'draft', investigation_status = 'failed'
  where id = p_estimate_id and organization_id = p_organization_id;
end;
$$;

revoke execute on function public.begin_investigation(uuid,uuid,uuid) from public, anon;
revoke execute on function public.answer_estimator_question(uuid,uuid,uuid,text) from public, anon;
revoke execute on function public.persist_investigation_result(uuid,uuid,uuid,text,text,jsonb,jsonb,jsonb) from public, anon;
revoke execute on function public.fail_investigation(uuid,uuid,uuid,text) from public, anon;

grant execute on function public.begin_investigation(uuid,uuid,uuid) to authenticated;
grant execute on function public.answer_estimator_question(uuid,uuid,uuid,text) to authenticated;
grant execute on function public.persist_investigation_result(uuid,uuid,uuid,text,text,jsonb,jsonb,jsonb) to authenticated;
grant execute on function public.fail_investigation(uuid,uuid,uuid,text) to authenticated;
