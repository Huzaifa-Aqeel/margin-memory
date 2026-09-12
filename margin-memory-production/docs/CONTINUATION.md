# Margin Memory — current continuation checkpoint

Updated 2026-09-12. This is the authoritative handoff for the next Codex session. Read this file first, then [ARCHITECTURE.md](ARCHITECTURE.md), [SECURITY.md](SECURITY.md), and [DEPLOYMENT.md](DEPLOYMENT.md). Do not reconstruct progress from old task history.

## Repository

- Workspace Git root: `/home/huzaifa-aqeel/Downloads/margin-memory-production-closed-loop`
- Application root: `margin-memory-production`
- The user initialized Git at the workspace root. `main` currently includes the initial source commit and Integration Phase 1 commit; review the small working-tree follow-up before the next commit.
- Workspace and application `.gitignore` files exclude dependencies, builds, environment secrets, Supabase temporary state, browser artifacts, editor state, and generated AgentCore files.
- `.env.local` contains the user's Supabase and AWS configuration. Never print credentials or commit this file.

## Current product state

Margin Memory implements its closed loop:

```text
draft → reviewed → submitted → won | lost → in_progress
      → completed → learning_review → learned
```

Postgres enforces commercial transitions, immutable submission snapshots, closeout prerequisites, warning/lesson review, tenant relationships, and submitted evidence immutability. One Strands investigator chooses focused tools; deterministic TypeScript and persisted investigation evidence own financial and numerical truth. Human approval remains required for bid and lifecycle decisions.

The runtime uses Amazon Bedrock without OpenAI. Local Strands + Bedrock is implemented and previously exercised with Nova Lite. Titan Embeddings G1 returned a validated 1536-value embedding. The optional AgentCore HTTP adapter and deployment generators exist, but AgentCore has not been deployed or verified.

## Completed integrity work

The original dependency, pgvector operator, subtotal, numerical provenance, stale investigation lease, redirect, lifecycle, and tenant-isolation failures are fixed.

Scope reconciliation preserves the original bid and separately records approved changes and actual allocations. Unreconciled history remains readable but is excluded from numerical evidence, semantic retrieval, lesson generation, and warning calibration.

Warning responses are immutable, attributable events. Closeout separately records condition occurrence and mitigation effectiveness. Mitigated outcomes are reported outside the warning hit-rate denominator. Evidence-strength labels describe sample and data coverage; they are not calibrated probabilities.

P0/P1 spreadsheet integrity is complete under the current regression suite and adversarial audits:

- strict US-format numerics and explicit blockers for ambiguous/malformed values;
- source-total capture and bounded reconciliation;
- rollup classification without dropping legitimate “total” descriptions;
- category, cost-code, phase, division, and labor-hour completeness;
- incomplete actuals cannot become authoritative evidence;
- one parser and resolved mapping for preview and persistence;
- visible worksheet selection with hidden/split-actual protections;
- SHA-256 review contracts bound to user, organization, files, parser, mapping, warnings, worksheets, and import context;
- private source staging before transactional database commit;
- idempotent replay through a consumed review record;
- mandatory line-level source provenance;
- immutable estimate revision/baseline identity;
- actual quantity, unit, normalized unit, rate, hours, code, phase, and division preservation;
- explicit UTF-8/CSV structure rejection and bounded XLSX/CSV resources;
- cleanup leases for expired staged uploads;
- service-only import commits and blocked legacy browser-RPC bypasses.

Detailed import behavior and limits live in [IMPORT_PRODUCTION_HARDENING.md](IMPORT_PRODUCTION_HARDENING.md).

Trusted professional memory hardening is also complete under the current local regression suite. Migration 019 adds one fail-closed eligibility policy for SQL and TypeScript, permanent production/demo origin separation, service-only lesson/vector transitions, versioned canonical embedding content and hashes, zero-vector/model/dimension checks, durable leased indexing jobs with retry state, automatic preflight reconciliation, stale invalidation, quarantine, lesson retrieval provenance, structured professional comparability, and internal readiness diagnostics. Legacy vectors without provable source/model identity are cleared for safe reindexing. See [TRUSTED_MEMORY.md](TRUSTED_MEMORY.md).

Integration Phase 1 is implemented. A thin Office.js Excel task pane captures only a selected visible table/range, creates a deterministic `excel_live_snapshot`, and sends it through the existing spreadsheet analyzer, durable review contract, immutable estimate-revision commit, preflight, trusted memory, calculations, questions, and evidence. It does not parse business meaning in Excel or modify the workbook. Migration 020 records explicit live-source identity, source bindings, and operational runs. See [EXCEL_INTEGRATION_PHASE1.md](EXCEL_INTEGRATION_PHASE1.md).

Agent terminal-state and demo safety hardening is complete. A live isolated reproduction established that Strands 1.17.0 returned `stopReason: limitTurns` with no `structuredOutput`; the old runtime ignored the stop reason and passed the optional field to Zod. The runtime now distinguishes validated completion, a validated `request_human_input` interrupt, and explicit failure. Migration 021 atomically and idempotently creates demo core data, leases/retries its external preflight, records durable failure, propagates demo origin through revisions/closeout, and exposes a demo-only tenant-safe reset. Demo and production origins are shown separately from legacy/closed-loop source labels. See [AGENT_RUNTIME_AND_DEMO_SAFETY.md](AGENT_RUNTIME_AND_DEMO_SAFETY.md).

A read-only hosted check confirmed that all eight fixture jobs (including the seven originally reported plus Oak Street Restaurant) currently exist with `data_origin = 'demo'`. It also confirmed the exact sample estimate `Riverside Office – Level 3` remains with `investigation_status = 'failed'`, matching the old route's write-then-preflight sequence. After migration 021 deploys, **Remove sample data** safely removes the eight origin-marked jobs. The older estimate predates estimate-origin tracking and must be inspected/deleted manually if desired; the reset deliberately does not infer production deletion from a name.

## Latest verification

Final local verification on 2026-09-12:

| Command | Result |
| --- | --- |
| `npm run verify` | Passed |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed, no warnings |
| `npm test` | 348 tests passed in 21 files |
| `npm run test:db` | 123 tests passed; all 21 migrations applied from zero on PostgreSQL 18 + pgvector |
| `npm run build` | Passed with Next.js 16.3.4 |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome npm run test:browser` | 10 tests passed |
| `npm run smoke:bedrock` | Agent model passed; Titan embedding returned and validated 1536 dimensions |
| Focused Excel/spreadsheet/review-contract suite | 112 tests passed |
| `OFFICE_ADDIN_ORIGIN=https://margin.example.com npm run excel:manifest` | Passed; generated manifest passed Microsoft's `office-addin-manifest` schema/acceptance validator |
| `git diff --check` | Passed |

The final commands ran successfully in the current environment. No check was disabled or weakened.

## Database deployment state

There are 21 forward-only migrations. Local zero-to-current migration verification passes. Hosted application of the newest migrations has not been verified. Migrations 017–021 must ship with the matching web code:

- `202609120017_import_production_hardening.sql`
- `202609120018_trusted_import_boundaries.sql`
- `202609120019_trusted_memory.sql`
- `202609120020_excel_integration_phase1.sql`
- `202609120021_safe_demo_seed.sql`

Pause imports during rollout, run `supabase db push --dry-run`, inspect the plan, then run `supabase db push`. Follow [DEPLOYMENT.md](DEPLOYMENT.md); do not rewrite applied migrations.

## Configured provider state

The last known non-secret selection was:

```text
AWS_REGION=us-east-1
BEDROCK_MODEL_ID=us.amazon.nova-lite-v1:0
EMBEDDING_PROVIDER=bedrock
BEDROCK_EMBEDDING_MODEL_ID=amazon.titan-embed-text-v1
AGENT_RUNTIME=local
```

Standard AWS SDK profile/role resolution is used. Do not rerun paid Bedrock smoke calls merely to repeat earlier proof. A Supabase server secret appeared in an earlier tool transcript; rotation was recommended but has not been verified. Confirm rotation before handling customer data.

## Remaining release work

Repository implementation is ready for a controlled pilot, subject to these external checks:

1. Review and commit the small Integration Phase 1 follow-up in the working tree; `.env.local`, `node_modules`, `.next`, test artifacts, generated manifests, and Supabase temporary files are confirmed ignored.
2. Apply migrations 017–021 to hosted Supabase with the matching application deployment, then reconcile company memory to rebuild legacy vectors with current hashes. Migration 021 is required before using the new demo seed/reset route.
3. Deploy the web application at a public HTTPS origin, add that origin and `/integrations/excel/auth-complete` to the allowed Supabase Auth URLs, generate the Office manifest with `OFFICE_ADDIN_ORIGIN`, and sideload/deploy it in Microsoft 365.
4. Run the complete Excel-host journey with a real desktop/web Excel host: sign in, inspect/select source, review exceptions, run/retry a check, answer a persisted question, and reopen the task pane.
5. Run the full signed-in journey against hosted Auth, Postgres, and Storage in a test organization.
6. Repeat cross-tenant reads, file access, signed-URL expiry, import retry, stale Excel-review rejection, and expired-upload cleanup against hosted Supabase.
7. Validate permissioned, deidentified real contractor exports using [CUSTOMER_IMPORT_VALIDATION_TASKS.md](CUSTOMER_IMPORT_VALIDATION_TASKS.md).
8. Conduct a pilot with 5–8 target contractors and 10–20 comparable jobs where available; measure import preparation, warning usefulness, false alarms, and repeat use.
9. Deploy AgentCore only if the hackathon/demo benefit justifies its added runtime and IAM setup. The working local Bedrock path should remain the fallback.

## Known limits

- Real customer-record compatibility has not yet been proven.
- CSV is UTF-8 only; Windows-1252 and other encodings must be re-exported.
- Margin Memory reads cached Excel formula results and does not evaluate formulas.
- Multi-sheet actual aggregation and construction unit conversion are unsupported.
- Expired-import cleanup is request/operations driven; no scheduled worker exists.
- ZIP/resource checks are bounded defenses, not proof against every parser CPU attack.
- Scope approval references and mitigation assessments are human attestations, not automated proof of customer approval or causal savings.
- Demo seed data is permanently marked `demo` and excluded from trusted retrieval, evidence, calculations, lessons, and warning calibration.
- Demo jobs created by the pre-021 route can be removed by the safe sample reset after migration 021. A pre-021 sample estimate has no durable estimate-origin marker and must be inspected manually; cleanup never guesses from its name.
- Real contractor retrieval relevance and Titan semantic quality have not yet been validated with permissioned pilot records.
- The PostgreSQL harness does not emulate hosted Auth, PostgREST, Storage HTTP behavior, email delivery, or session refresh.
- Office manifest validation passes, but actual Excel desktop/web host behavior has not been exercised in this environment.
- Phase 1 supports one explicitly selected visible worksheet/table/range. It does not aggregate several worksheets into one estimate.

## Do not redo

Do not replace Supabase, the lifecycle, the single-agent design, pgvector, the evidence ledger, or the importer. Do not create an Excel-specific parser or agent. Do not add OpenAI to make Strands run. Do not weaken P0/P1 blockers, use generic review booleans for hard failures, overwrite historical bid truth, or let incomplete actuals enter authoritative memory. Begin the next session with the external release sequence above or a newly scoped product task.
