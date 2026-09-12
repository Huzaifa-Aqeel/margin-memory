# Trusted company memory

Migration 019 makes company memory a derived, fail-closed projection of authoritative business records.

## Eligibility

A job is eligible only when its scope/actual completeness review is reconciled (`no_changes` or `adjusted`), its baseline is explicitly `original_bid` or `final_submitted`, its `data_origin` is `production`, and its `memory_status` is `trusted`. Null or `historical_unknown` baselines, demo/test data, quarantined jobs, and incomplete imports are excluded. A lesson additionally requires `status = confirmed` and an eligible source job. The SQL functions `is_job_eligible_for_trusted_memory` and `is_lesson_eligible_for_trusted_memory` enforce the database boundary; `src/lib/domain/memory-policy.ts` is the matching application policy.

## Index lifecycle

The application builds a versioned, privacy-minimized canonical representation, hashes it with SHA-256, and upserts one durable `memory_index_jobs` item per source. A leased worker calls Bedrock, then `complete_memory_index_job` compares the lease and desired hash before writing the vector. Writes require the organization's exact provider/model/dimension space and reject zero-norm vectors. Failed calls retain their error, attempt count, and retry time. Preflight runs bounded reconciliation automatically; the Memory action remains an operational retry.

Source-field triggers invalidate vectors when a job, job line, variance, scope review, or lesson changes. Reconciliation adds missing vectors, refreshes stale vectors, and disables ineligible sources. Quarantine preserves the financial/audit record while immediately removing the job and derived lessons from retrieval, calculations, evidence, and warning calibration.

## Retrieval and evidence

Job retrieval begins with eligible jobs that pass structured comparability for project/commercial class, size, category mix, labor mix, available cost-code/phase overlap, and age. Semantic ranking then runs only over those candidate IDs. Lesson retrieval returns exact lesson/source-job IDs; the search evidence persists those IDs, the query, timestamp, and rank/similarity data. A finding that uses a lesson references that persisted search evidence. Numerical claims still require current-investigation deterministic calculation evidence.

Browser roles cannot read vectors or mutate `job_search_documents`, lesson vectors, embedding metadata, embedding-space configuration, or lesson status. Confirmation, rejection, revision, quarantine, queue writes, and vector completion are service-role RPCs that independently verify actor membership. `getMemoryDiagnostics` gives internal server tooling the excluded-job reasons and durable per-source failures without exposing vectors.

## Operational limits

The active production embedding is Amazon Bedrock Titan G1 (`amazon.titan-embed-text-v1`, 1536 dimensions). Changing semantic space requires an explicit reindex. Retry processing is opportunistic before preflight and through the Memory action; a separately scheduled worker is optional for lower latency, not required for fail-closed correctness. Real contractor retrieval relevance and Titan language quality still require pilot validation.
