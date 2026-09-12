# Architecture

Margin Memory remains a desktop-first estimate/preflight application with a mobile Inbox. Supabase owns identity, tenant records, private files, semantic memory and the commercial lifecycle. A single Strands investigator selects what to investigate. It cannot change pricing, submit bids, contact customers or commit money.

## Numerical and evidence boundary

Every search, inspection, calculation, document inspection, missing-category calculation and warning-calibration result receives an investigation-scoped ID. The server persists each ledger entry before returning its ID to the investigator. Ledger rows are immutable. Search results authorize which historical jobs this investigation may inspect or calculate against.

Evidence strength is derived from persisted deterministic calculations: usable comparison count, comparable-job count, missing category data and reconciled scope. It is shown as insufficient, limited, moderate or strong with the underlying basis. These labels describe evidence coverage; they are not probabilities of correctness or causal claims.

The final model schema contains category, severity, a review-action selection and evidence references. It has no free-form numerical claim fields. Unknown fields and foreign/missing calculation references are rejected. Each historical job must have been retrieved and then inspected or consumed by a referenced calculation. Server rendering produces sample size, frequency, median, range, cost and hour differences from persisted tool results. Recommendations/questions are selected from bounded review actions, preventing numerical prose from bypassing the fact boundary. This deliberately limits prose flexibility; expand the action vocabulary in code with tests.

Configured Bedrock failures, malformed output, indexing failures and lease loss remain failures. They are not silently replaced with a successful review. An empty BEDROCK_MODEL_ID explicitly enables a labelled deterministic development review using the same provenance boundary.

## Durable execution

Beginning a review locks the estimate. A live 90-second lease rejects duplicates; an expired lease is marked failed with lease_expired and a replacement attempt is inserted atomically. A separate execution claim prevents duplicate transport delivery from running the same attempt twice. The worker renews every 20 seconds and at tool boundaries; lease loss aborts the model and prevents committing its output. Old workers cannot reset a newer attempt. Results, findings, questions and estimate status commit transactionally.

Answers remain persisted estimator context. They cannot change a live worker's input. Commercial transitions require a completed review and no unresolved findings/questions. No agent tool exposes a commercial mutation.

## Historical integrity

Submitted findings snapshot the final investigation's warnings, ledger entries, source evidence, estimate lines and document text. Snapshot updates/deletes are blocked even for privileged writes. Normal clients cannot mutate submitted findings or imported cost lines. Imported facts are append-only; corrections require explicit new estimates/imports rather than silently overwriting a submitted bid. Completed jobs cannot be linked by a direct client write.

Imports use staged private source objects and durable review contracts. SHA-256 file identity, parser version, selected worksheet, semantic mapping, reports, warnings, user, organization and import context are bound before commit. Service-only transactional RPCs consume a contract once, attach source documents and line provenance, and return the original result on safe replay. Estimate revisions are separate immutable estimates in one revision group; closeout compares actuals to the specific completed revision. See `IMPORT_PRODUCTION_HARDENING.md`.

Imported totals and variances are recalculated inside transactional RPCs. Import RPCs use SECURITY DEFINER because direct writes to immutable fact tables are revoked; they explicitly check authenticated organization membership first. Ordinary reads, vector searches and Storage requests still use the user's JWT and RLS. Trusted agent writes require a server-only secret and independently check actor membership.

The lifecycle remains draft → reviewed → submitted → won/lost → in_progress → completed → learning_review → learned. Actuals attach to the same estimate through its linked completed job. Learned requires all submitted warning outcomes and proposed lessons to receive human review.

Approved scope changes are stored separately from the immutable original bid and final actuals. Deterministic comparison can use the approved adjusted baseline while retaining the raw variance. Missing or unreconciled scope remains visible but is excluded from numerical evidence, vector retrieval, lesson generation and warning calibration.

Estimator responses to warnings are append-only records with actor, time, lifecycle stage and optional revision reference. Closeout asks separately whether the warned condition occurred and whether a completed mitigation helped. A mitigated outcome is not counted as a failed warning, and no response is treated as causal proof or an automatic estimate change.

## Model and memory providers

The investigator uses Strands BedrockModel with AWS SDK credential resolution. Embeddings are an independent provider module. Titan Embeddings G1 - Text (amazon.titan-embed-text-v1) and Cohere Embed v4 both use exactly 1536 dimensions, matching existing columns/indexes. Titan sends inputText and reads embedding; Cohere uses its own corpus/query input types and response shape. The organization embedding-space record prevents mixing models even when dimensions match.

Each workspace records its embedding provider/model/dimensions. Legacy populated indexes are tagged as OpenAI text-embedding-3-small and cannot be reused as Bedrock indexes. Changing provider requires an explicit administrative reset and full reindex; no mixed vector space is searched. No OpenAI dependency or key is required by the application.

## Verification boundary

Vitest exercises actual parsers, provenance rendering, leases and real PostgreSQL migrations/RLS/RPCs. The PostgreSQL harness provides minimal Supabase-compatible auth/storage schemas; it does not emulate hosted Auth or Storage HTTP behavior. Browser smoke tests cover unauthenticated routing and signup/login entry on desktop/mobile. A full authenticated journey and live Bedrock invocation require configured external services and are separate release checks.
