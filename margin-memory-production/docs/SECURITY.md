# Security and Data Boundaries

Margin Memory handles commercially sensitive bids, job costs, supplier information, and project documents. Treat authorization and provenance as product features.

## Authentication

Supabase Auth provides identity. Server-side route protection uses verified JWT claims (`getClaims`) through the Next.js `proxy.ts` pattern. Do not authorize requests using unverified cookie/session payloads.

## Tenant isolation

Every business table carries `organization_id`; RLS is enabled on every tenant table. Composite `(organization_id, parent_id)` foreign keys prevent a child row from referencing a parent in another tenant even if a UUID is guessed. `is_org_member` and `is_org_owner` are `SECURITY DEFINER` membership predicates with an empty search path. Ordinary tenant reads and private Storage access use the signed-in user's publishable-key client and RLS. Agent and import persistence use narrower trusted-server RPCs: direct authenticated DML on investigations, findings, evidence, human-question, review-contract, and provenance rows is revoked. Every trusted call carries the already-authenticated actor user id and re-checks organization membership inside Postgres. Human lifecycle/resolve/answer RPCs remain authenticated operations but enforce lifecycle and membership rules inside the database.

Import review creation and commit follow the same trusted-server pattern. Authenticated clients cannot directly read or mutate `import_reviews`, `import_review_files`, or `import_line_provenance`, and cannot execute their commit RPCs. The server passes the authenticated actor; Postgres checks membership, organization-scoped relationships, review ownership, expiry, warning acknowledgements and single-consumption state. Storage objects are staged under the organization's private prefix before the database transaction.

The public Excel task-pane documents are limited to `/integrations/excel` and its same-origin auth-completion page. Excel mutation APIs remain protected by session middleware and repeat identity/workspace checks in server services. The task pane never receives a service key, AWS credential, organization authority, or vector. Migration 020 revokes authenticated access to Excel source bindings and operational runs; the reviewed source identity, snapshot hash, baseline, and estimate relationship are enforced in the service-only commit transaction. Only selected visible range/table data is transmitted.

`SUPABASE_SECRET_KEY` must exist only in trusted server runtime. Never put it in `NEXT_PUBLIC_*`, browser code, logs, client bundles, or source control.

## Storage

The `job-files` bucket is private. Object keys start with `organization_id`, and Storage RLS checks membership against that first folder segment. Source files are exposed to the UI through five-minute signed URLs.

The migration caps individual files at 25 MB. The route handlers also validate size before database writes. Extend MIME rules only deliberately.

## LLM / embedding data

When Bedrock features are enabled, relevant estimate context, historical search text, and agent tool results can be sent to the configured AWS model/embedding endpoint. Review your AI provider's retention and data-processing settings before onboarding customers with contractual confidentiality requirements.

Raw API keys stay server-side. Do not log estimate/document contents in production logs.

## Human verification

Pending and rejected lessons are not embedded or retrievable as trusted company memory. Confirmation uses a service-only transition that verifies the source job is eligible; browser clients cannot write lesson status, vectors, hashes, or embedding metadata. Demo, unknown-baseline, unreconciled, and quarantined source jobs remain excluded even when a lesson row says `confirmed`.

## Evidence provenance

Agent findings store explicit `finding_evidence` rows referencing completed jobs. Quantitative results are generated from normalized deterministic records. Avoid adding UI that displays uncited model-generated dollar/hour claims.

## Recommended pre-production tests

Before external onboarding:

1. Create two organizations and users.
2. Import jobs/files into each.
3. Verify user A cannot select, update, RPC-search, sign, or delete user B's rows/files.
4. Verify changing an `organization_id` in a direct REST/RPC request is rejected by RLS.
5. Verify signed URLs expire and the private bucket cannot be fetched anonymously.
6. Verify a failed import transaction leaves no parent/child partial records.
7. Verify a failed investigation never marks an estimate `ready`.
8. Verify an unconfirmed lesson never appears in `match_lessons`.
9. Verify logs do not contain full bid/document payloads.
10. Verify direct PostgREST attempts cannot skip lifecycle stages, edit lifecycle-managed estimate fields, or mutate warning-outcome/audit rows.
11. Verify authenticated browser clients cannot directly insert/update/delete investigations, findings, evidence, or human-question rows, and cannot execute the trusted agent persistence RPCs.
12. Verify submitted preflight findings cannot be inserted, edited, or deleted and that `submission_findings` contains only the final completed investigation snapshot.
13. Verify closeout is idempotent after a successful commit and cannot run before `completed`.
14. Verify `learned` cannot be reached while a warning outcome or lesson remains pending.
15. Enable Supabase backups/PITR appropriate to your plan and test restore procedures.

## Lifecycle integrity

Lifecycle-managed estimate fields (`submitted_amount`, award/completion timestamps, contract value, closeout timestamps/notes) are not directly writable by the authenticated PostgREST role. Narrow lifecycle RPCs are `SECURITY DEFINER`, have an empty `search_path`, explicitly verify organization membership, and are backed by a transition trigger. `finding_outcomes` and `lifecycle_events` are tenant-readable but direct writes are revoked; they are written through guarded RPCs. Preflight findings are frozen after submission by a database trigger. Submission also snapshots the exact final-investigation warnings into immutable `submission_findings`; closeout must evaluate exactly that set before learning can finish.

## Hardened boundaries

Migrations 006–021 add immutable tool evidence, atomic leases and execution claims, immutable submission snapshots, scope and warning-response records, embedding-space identity, structured actual-completeness checks, durable import reviews, source provenance, revision identity, idempotent commits, staged-file cleanup, service-only import boundaries, canonical memory eligibility, durable vector jobs, freshness invalidation, quarantine, Excel live-source/revision binding, and tenant-scoped atomic demo seed/reset operations. Demo cleanup derives the tenant from the authenticated server session and its SQL predicates can target only non-production rows. See [ARCHITECTURE.md](ARCHITECTURE.md), [TRUSTED_MEMORY.md](TRUSTED_MEMORY.md), [EXCEL_INTEGRATION_PHASE1.md](EXCEL_INTEGRATION_PHASE1.md), and [AGENT_RUNTIME_AND_DEMO_SAFETY.md](AGENT_RUNTIME_AND_DEMO_SAFETY.md). `npm test` runs regression attempts against a fresh PostgreSQL database; hosted Auth/Storage checks still require a real Supabase project.
