-- Defense in depth: prevent cross-tenant parent/child references even if an ID is guessed.
-- RLS controls access; these composite FKs also enforce tenant-consistent relational integrity.

alter table public.jobs add constraint jobs_org_id_id_unique unique (organization_id, id);
alter table public.estimates add constraint estimates_org_id_id_unique unique (organization_id, id);
alter table public.investigations add constraint investigations_org_id_id_unique unique (organization_id, id);
alter table public.findings add constraint findings_org_id_id_unique unique (organization_id, id);

alter table public.job_estimate_lines
  add constraint job_estimate_lines_org_job_fk
  foreign key (organization_id, job_id) references public.jobs(organization_id, id) on delete cascade;

alter table public.job_actual_lines
  add constraint job_actual_lines_org_job_fk
  foreign key (organization_id, job_id) references public.jobs(organization_id, id) on delete cascade;

alter table public.job_variances
  add constraint job_variances_org_job_fk
  foreign key (organization_id, job_id) references public.jobs(organization_id, id) on delete cascade;

alter table public.lessons
  add constraint lessons_org_job_fk
  foreign key (organization_id, job_id) references public.jobs(organization_id, id) on delete cascade;

alter table public.job_search_documents
  add constraint job_search_documents_org_job_fk
  foreign key (organization_id, job_id) references public.jobs(organization_id, id) on delete cascade;

alter table public.estimate_lines
  add constraint estimate_lines_org_estimate_fk
  foreign key (organization_id, estimate_id) references public.estimates(organization_id, id) on delete cascade;

alter table public.investigations
  add constraint investigations_org_estimate_fk
  foreign key (organization_id, estimate_id) references public.estimates(organization_id, id) on delete cascade;

alter table public.findings
  add constraint findings_org_estimate_fk
  foreign key (organization_id, estimate_id) references public.estimates(organization_id, id) on delete cascade;

alter table public.findings
  add constraint findings_org_investigation_fk
  foreign key (organization_id, investigation_id) references public.investigations(organization_id, id) on delete set null (investigation_id);

alter table public.finding_evidence
  add constraint finding_evidence_org_finding_fk
  foreign key (organization_id, finding_id) references public.findings(organization_id, id) on delete cascade;

alter table public.finding_evidence
  add constraint finding_evidence_org_job_fk
  foreign key (organization_id, job_id) references public.jobs(organization_id, id) on delete cascade;

alter table public.human_questions
  add constraint human_questions_org_estimate_fk
  foreign key (organization_id, estimate_id) references public.estimates(organization_id, id) on delete cascade;

alter table public.human_questions
  add constraint human_questions_org_investigation_fk
  foreign key (organization_id, investigation_id) references public.investigations(organization_id, id) on delete set null (investigation_id);

alter table public.human_questions
  add constraint human_questions_org_finding_fk
  foreign key (organization_id, finding_id) references public.findings(organization_id, id) on delete set null (finding_id);

alter table public.documents
  add constraint documents_org_job_fk
  foreign key (organization_id, job_id) references public.jobs(organization_id, id) on delete cascade;

alter table public.documents
  add constraint documents_org_estimate_fk
  foreign key (organization_id, estimate_id) references public.estimates(organization_id, id) on delete cascade;
