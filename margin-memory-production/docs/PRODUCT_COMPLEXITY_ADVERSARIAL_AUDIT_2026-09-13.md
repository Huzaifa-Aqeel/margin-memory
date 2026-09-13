# Margin Memory Product, Domain, and AI-UI Adversarial Audit

**Audit date:** 2026-09-13  
**Audit mode:** Read-only  
**Repository state after audit:** Clean; no production source or migration changes  
**Verdict:** **B. The core professional workflow is strong, but unnecessary UI/domain complexity is obscuring it.**

## Executive assessment

Margin Memory serves a real professional need: closing the feedback loop between estimates and actual job performance, then bringing that evidence into the next bid. Its strongest parts are the import integrity controls, immutable submission record, scope reconciliation, verified lessons, trusted-memory policy, and deterministic evidence calculations.

The database is not bloated. All 30 application tables have defensible responsibilities tied to business truth, provenance, lifecycle integrity, tenant safety, search projections, or retry handling.

The main problems are in the product surface:

- The estimate detail page can falsely show **“No open historical risks”** while an investigation is queued, running, waiting for input, or failed.
- Normal estimators see Strands, agent cycles, tool counts, embedding models, indexing failures, and memory rebuild controls.
- Importing history and closing out jobs require considerable clerical entry.
- Several dashboard metrics and the estimate “attention score” are weakly actionable or unsupported.
- Excel reduces file-transfer friction, but still requires metadata entry and has not been verified in a real Excel host.

No takeoff, automatic pricing, proposal, scheduling, invoicing, payroll, dispatch, CRM, or workbook-modification scope creep was found. The intended product boundary remains intact.

## Method and evidence limits

The audit used all three requested evidence layers:

1. **Source code:** all user-facing routes, relevant components, repositories, API boundaries, agent provenance, demo behavior, Excel integration, and lifecycle behavior were inspected.
2. **Database and migrations:** all 21 forward migrations were inspected. A disposable PostgreSQL database applied every migration from zero, and the database regression suite exercised tenant, lifecycle, import, provenance, vector, and memory boundaries.
3. **Browser behavior:** the application was run locally, public routes were opened, and Playwright exercised authentication boundaries, the signed-out Excel task pane, and production import/scope/outcome components.

The browser environment did not include a disposable Supabase Auth/PostgREST stack. The read-only requirement also prohibited creating a hosted test tenant. Therefore, the audit did not claim a complete authenticated browser-to-hosted-PostgreSQL journey.

The Excel integration was inspected through source, contracts, tests, and its browser task-pane surface. It was not run inside a compatible Excel host.

## Current problem-space evidence

The problem is real, but another disconnected application would struggle.

A 2026 Electrical Contractor survey of 926 respondents found that 58% worked in firms with 1–9 employees and 70% were owners or top managers. That supports Margin Memory’s owner-estimator target, but it also means users have limited time for data administration. [Electrical Contractor 2026 Profile](https://www.ecmag.com/magazine/articles/article-detail/2026-profile-of-the-electrical-contractor)

Estimators are actively trying to build historical cost trackers in Excel. A recent discussion describes maintaining seven years of project history and using macros to export submitted bids into a historical-rate table. An older thread describes the same missing feedback loop and says the difficult part was justifying the time required to maintain it. [2026 historical-data discussion](https://www.reddit.com/r/estimators/comments/1sruv93/historical_data_tracker_how_do_you_keep_up/), [historical feedback-loop discussion](https://www.reddit.com/r/estimators/comments/iwmfe0/cataloging_and_maintaining_historical_data/)

The adoption risk is equally clear. A 2025 RICS survey of more than 2,200 construction professionals identified integration with existing systems as a barrier for 37% and data quality as a barrier for 30%; 79% reported no AI implementation or only early pilots. [RICS AI in Construction report](https://www.rics.org/news-insights/artificial-intelligence-in-construction-report)

Estimator discussions remain skeptical of AI-created takeoffs and labor estimates because bad results can materially damage a company. Participants are more comfortable with AI supporting comparison, summarization, and repetitive work while the estimator retains judgment. [2026 estimator discussion](https://www.reddit.com/r/estimators/comments/1rbatlm/future_of_estimating/)

Vendor surveys are directional rather than independent evidence, but they point in the same direction. Intuit reports that the typical construction firm uses 10 applications and 75% of surveyed decision-makers spend too much time managing disconnected data. A ServiceTitan-commissioned survey found that embedded features were the most common way respondents used AI. [Intuit construction technology report](https://erp.intuit.com/blog/guide/construction-digital-transformation-survey/), [ServiceTitan commissioned report](https://www.servicetitan.com/press/ai-in-the-skilled-trades-report-2025)

The product’s honest position is:

> Margin Memory should be an evidence-backed review layer embedded into Excel and established estimating/job-cost workflows. It should not ask users to operate a separate AI or data-management system.

## P0 finding: false zero-finding presentation

`src/app/estimates/[id]/page.tsx` displays:

> No open historical risks

whenever there are no open finding rows. It does not first require:

```text
investigationStatus === completed
```

Consequently, a draft estimate can look safely cleared while its investigation is:

```text
queued
investigating
needs_input
failed
```

The database still prevents such an estimate from being marked reviewed or submitted: `transition_estimate_lifecycle` requires `status='ready'` and `investigation_status='completed'`. Financial history is protected, but the user-facing professional claim is wrong.

The Excel presentation already distinguishes running, human-input, failed, findings, and completed-zero-findings states correctly.

## Real user journeys

| Journey | Observed behavior | Judgment vs clerical work | Result |
|---|---|---|---|
| Fresh organization | Code creates an empty private workspace. Demo data appears only after an explicit sample action and is visibly labeled. | Company name is necessary. | **PASS in code; authenticated hosted journey unverified.** |
| Historical import—clean | Two files, metadata, preview, scope decision, then import. Integrity report is comprehensive. | Baseline, completeness and scope require judgment. Name, location, type, date and tags are often inferable. | **Functionally strong, high friction.** |
| Historical import—ambiguous | User selects worksheet, previews again, reviews exact exceptions, then commits. | Appropriate professional intervention. | **PASS.** |
| Historical import—hard invalid | Hard parsing/reconciliation failures block commit and cannot be acknowledged away. | Appropriate. | **PASS.** |
| Historical import—retry | Review/operation identity returns one logical import. | Invisible to user. | **PASS in automated tests.** |
| New estimate | Upload, preview, enter six metadata areas and optional documents/assumptions, then run review. | Project context is useful, but repeated metadata entry is friction. | **PARTIAL.** |
| Pre-submit finding | Findings separate calculated claim, rationale, action and job links. | Estimator resolves/dismisses and remains in control. | **PASS with UI-language issues.** |
| Zero findings | Agent renderer and Excel correctly support zero findings. Web detail page does not prove completion before showing success. | No user intervention should be required. | **FAIL on web presentation.** |
| Human question | Question is persisted; request ends; user later answers; investigation resumes. | Focused professional judgment. | **PASS in code/tests; authenticated UI journey unverified.** |
| Reviewed/submitted | Findings and responses are resolved, review is locked, submission snapshot is immutable. | Necessary commercial confirmation. | **PASS.** |
| Won/lost | Captures outcome and contract value/loss reason. | Necessary fact, but a future source integration should supply it. | **Useful but duplicative entry.** |
| In progress/completed | User manually clicks Start Work and Mark Completed. | Usually available in project/accounting software. | **Duplicate of existing tools.** |
| Closeout | Actuals import, scope reconciliation, warning-outcome review and lesson confirmation. | Outcome and lesson decisions require judgment; change allocation is clerical. | **Core value, high friction.** |
| Excel | Captures one visible table/range/sheet, applies existing server checks, re-captures before check, runs the same preflight. | Still asks for name/type/customer/location. | **Sound code path; real Excel host unverified.** |

A clean historical import currently requires roughly two primary actions—preview and import—but also at least two files, multiple metadata fields and a scope judgment. Ambiguous workbooks add worksheet selection and re-preview. It feels closer to controlled data onboarding than “drop in my records.”

## Complete user-facing functionality and page audit

| Page / feature | Professional task | Who / frequency / judgment | Can software infer it? | Existing-tool duplication | Classification | AI-related marking | Friction | Recommendation |
|---|---|---|---|---|---|---|---|---|
| `/login`, `/signup` | Access private company history | All users; infrequent; no estimating judgment | No | No | NECESSARY SUPPORTING WORKFLOW | Low | Normal | Keep |
| `/onboarding` | Establish company workspace | Owner/admin; once | No | No | NECESSARY SUPPORTING WORKFLOW | “What company are we remembering?” is acceptable branding | Low | Keep |
| `/` Dashboard | See today’s review and learning work | Owner/estimator; daily | Mostly | Partly overlaps source systems | NECESSARY SUPPORTING WORKFLOW | “Trusted memory,” warning hit rate | Medium | Change metrics and wording |
| `/preflight` | Find current estimates and lifecycle state | Estimator; frequent | No | No | CORE PROFESSIONAL WORKFLOW | Shows Agent, Strands, deterministic | Medium | Rename to Estimates/Bids; hide runtime |
| `/estimates/new` | Start a pre-submit review | Estimator; every bid | Some metadata can be inferred | Spreadsheet selection duplicates export handling | CORE PROFESSIONAL WORKFLOW | “Agent is investigating” | High metadata burden | Keep; infer/reuse metadata |
| Estimate revision | Preserve a changed bid baseline | Estimator; as needed; commercial judgment | No | Complements estimating tool | CORE PROFESSIONAL WORKFLOW | None material | Moderate | Keep |
| `/estimates/[id]` lifecycle | Review and advance commercial state | Estimator/owner; frequent | Some milestones can be synchronized | Won/start/complete overlap operational tools | CORE PROFESSIONAL WORKFLOW | Agent preflight card | Moderate | Keep; fix status presentation |
| Findings | Recheck a material risk | Estimator; 0–3 per bid; judgment required | No | No | CORE PROFESSIONAL WORKFLOW | Appropriate interpretation language | Low | Keep |
| Evidence links | Explain why a warning exists | Estimator/reviewer; as needed | Generated from evidence | No | CORE PROFESSIONAL WORKFLOW | Evidence strength is appropriate | Medium | Add structured evidence drill-down |
| Finding resolve/dismiss | Record estimator decision | Estimator; per finding | No | No | CORE PROFESSIONAL WORKFLOW | None | Low | Keep |
| Human question | Supply a missing material fact | Estimator; exception-only | No | No | CORE PROFESSIONAL WORKFLOW | Professional, not chat-like | Low | Keep |
| Reviewed state | Lock completed review | Estimator; every submitted bid | No | No | CORE PROFESSIONAL WORKFLOW | None | Low | Keep |
| Submitted state/snapshot | Preserve bid truth | Estimator/owner; every bid | Can sometimes sync, but confirmation matters | Mild overlap with estimating/CRM | CORE PROFESSIONAL WORKFLOW | None | Low | Keep |
| Won/lost | Preserve commercial outcome | Owner/estimator; once per bid | Future CRM/accounting integration can supply it | Yes | NECESSARY SUPPORTING WORKFLOW | None | Moderate | Keep until integration |
| Start/complete work | Supply lifecycle milestones | PM/owner; once per won job | Usually available externally | Yes | DUPLICATE OF EXISTING TOOL | None | Clerical | Later infer/sync |
| Closeout actuals | Compare submitted baseline with outcome | Estimator/owner; once per won job | File retrieval can be automated | Complements accounting | CORE PROFESSIONAL WORKFLOW | “Import actuals and learn” acceptable | Medium | Keep |
| Scope reconciliation | Separate estimating error from changed scope | Estimator/PM; expert judgment | Software can propose, not decide | No | CORE PROFESSIONAL WORKFLOW | None | High | Keep judgment; reduce entry |
| Approved-change allocation | Record budget/actual effect by category | Estimator/PM; per change | Often inferable from CO/job-cost exports | Duplicates PM/accounting data | UNNECESSARY FRICTION | None | Very high | Import/suggest, user confirms |
| Warning outcome review | Decide whether interruption proved useful | Estimator; per submitted warning | Software may propose only | No | CORE PROFESSIONAL WORKFLOW | “System verdict,” confidence remnants | Medium | Keep; use calculated-check wording |
| Lesson review | Confirm reusable company knowledge | Estimator; per closeout | Cannot safely infer authority | No | CORE PROFESSIONAL WORKFLOW | Memory metaphor is appropriate | Low | Keep |
| `/jobs` | Browse completed-job evidence | Estimator/owner; frequent | No | Does not replace accounting ledger | CORE PROFESSIONAL WORKFLOW | Little AI marking | Low | Keep |
| `/jobs/new` | Import old completed history | Estimator/admin; onboarding/batch | Much metadata can be inferred | File/export work overlaps source systems | NECESSARY SUPPORTING WORKFLOW | Little AI marking | High | Keep, streamline |
| `/jobs/[id]` | Inspect estimate/actual variance and sources | Estimator/owner; as needed | Calculations are automatic | No | CORE PROFESSIONAL WORKFLOW | “System” outcomes | Low | Keep |
| Line source trace | Explain source of a financial line | Auditor/reviewer; rare | Automatic | No | NECESSARY INFRASTRUCTURE — SHOULD MOSTLY BE INVISIBLE | None | Hidden in disclosure | Keep |
| `/memory` lesson list | Browse verified lessons | Estimator; occasional | No | No | USEFUL SECONDARY FEATURE | Memory/index terminology | Medium | Merge lesson work into Inbox/History; keep secondary |
| Memory indexing status | Operate vector/index recovery | Internal operator; rare | Should be automatic | No | WRONG USER ABSTRACTION | Model/index/rebuild exposed | High | Hide in internal diagnostics |
| `/inbox` | Resolve only questions/outcomes/lessons | Estimator; frequent exception handling | No | No | CORE PROFESSIONAL WORKFLOW | Good restrained language | Low | Keep |
| Demo/sample data | Explore product safely | New user; once | Automatic after explicit request | No | USEFUL SECONDARY FEATURE | Clearly marked | Low | Keep explicit and isolated |
| `/integrations/excel` | Review without leaving workbook | Excel estimator; every relevant bid | Source selection partly automatic | Complements Excel | CORE PROFESSIONAL WORKFLOW | “Margin Check” is appropriate | Medium | Keep; validate in real host |
| Excel source selection | Limit transmitted workbook data | Estimator; exception-only | Safe candidate can be inferred | No | NECESSARY SUPPORTING WORKFLOW | None | Appropriate | Keep |
| `/integrations/excel/auth-complete` | Return authentication to Office dialog | All Excel users; rare | Automatic | No | NECESSARY INFRASTRUCTURE — SHOULD MOSTLY BE INVISIBLE | None | Invisible | Keep |
| `/error` | Explain auth/runtime error | Any user; exceptional | Automatic | No | NECESSARY SUPPORTING WORKFLOW | None | Low | Keep |

Removing import integrity, provenance, revisioning, submission snapshots, reconciliation, verified lessons, evidence calculations, or tenant boundaries would materially weaken the product. Removing agent/runtime/index terminology from normal screens would not.

## Navigation audit

| Item | User question | Frequency | Recommendation |
|---|---|---:|---|
| Dashboard | What requires attention today? | Daily | **KEEP** |
| Preflight | Which bids are being reviewed? | Frequent | **RENAME** to Estimates or Bids |
| Completed jobs | What happened on past work? | Frequent | **KEEP**, possibly “Job history” |
| Memory | What lessons are retained? | Occasional | **SECONDARY**; lessons can live under Job History/Inbox |
| Inbox | What judgment is waiting from me? | Frequent | **KEEP** |
| Review estimate | Can I check this bid? | Frequent | **KEEP** |

Simplest coherent navigation:

```text
Dashboard
Estimates
Job History
Inbox

Primary action: Margin Check / Review estimate
Secondary: Lessons
```

## Dashboard audit

| Card | Does it change today’s action? | AI decoration / evidence | Verdict |
|---|---|---|---|
| Open preflight risks | Yes | Backed by open findings | **KEEP** |
| Trusted completed-job memory | Sometimes; communicates readiness | Backed by eligibility policy | **SECONDARY** |
| Adjusted budget variance | Weakly; mean absolute variance loses direction and category meaning | Deterministic but not actionable | **REMOVE** |
| Observed warning hit rate | Potentially, but small samples can look statistically meaningful | Backed by reviewed outcomes, no minimum-sample gate | **SECONDARY** until sample rules exist |
| Live estimates/jobs | Yes | Structured facts | **KEEP** |
| Recent completed jobs | Yes | Structured facts | **KEEP** |
| Demo/new-workspace card | Yes during onboarding | Explicit and isolated | **KEEP** |

## AI-language audit

| Text / concept | Location | Current meaning | Supported by backend? | Classification | Keep / Rename / Hide / Remove |
|---|---|---|---|---|---|
| Margin Memory / company memory | Brand, dashboard, lessons | Verified company history carried forward | Yes | PROFESSIONALLY USEFUL | **KEEP** |
| “Evidence-first estimating agent” | Page metadata | Product description | Partly | UNNECESSARY AI BRANDING | **RENAME** to professional review layer |
| “Agent investigates. You decide.” | Navigation footer | Model selects investigation tools; user controls decisions | Yes | UNNECESSARY AI BRANDING | **RENAME** to “Margin Memory checks. You decide.” |
| Agent column | Preflight list | Strands/deterministic runtime | Yes, but irrelevant | INTERNAL CONCEPT LEAKED INTO UI | **HIDE** |
| Strands | Preflight list | SDK/runtime implementation | Yes | INTERNAL CONCEPT LEAKED INTO UI | **REMOVE** from normal UI |
| deterministic | Preflight list | Fallback execution mode | Yes | ACCEPTABLE TECHNICAL TRANSPARENCY only for diagnostics | **HIDE** |
| “Agent is investigating” | Upload button | Review is running | Yes | UNNECESSARY AI BRANDING | **RENAME** to “Running Margin Check…” |
| Agent preflight | Estimate sidebar | Review summary | Yes | UNNECESSARY AI BRANDING | **RENAME** to Margin Check |
| Agent cycles/tools | Estimate details | Runtime telemetry | Yes | INTERNAL CONCEPT LEAKED INTO UI | **HIDE** or internal-only |
| “TypeScript tools” | Trust-boundary card | Calculations are code-owned | Yes | INTERNAL CONCEPT LEAKED INTO UI | **RENAME** to verified calculations/source evidence |
| Attention score | Estimate sidebar | Severity-weighted arbitrary formula | No professional/calibrated meaning | AI THEATER | **REMOVE** |
| Evidence strength | Findings | Deterministic sample/comparability label | Yes | PROFESSIONALLY USEFUL | **KEEP** |
| Historical evidence | Findings | Retrieved and inspected eligible jobs | Yes | PROFESSIONALLY USEFUL | **KEEP** |
| Verified lesson | Lessons/dashboard | Human-confirmed eligible lesson | Yes | PROFESSIONALLY USEFUL | **KEEP** |
| Investigation | Various status details | Persisted review execution | Technically yes | INTERNAL CONCEPT LEAKED INTO UI | **HIDE/RENAME** as review progress |
| Trusted memory indexed with model | Memory readiness | Vector provider/model state | Yes | INTERNAL CONCEPT LEAKED INTO UI | **HIDE** in internal diagnostics |
| Update company memory | Memory page | Retry/reconcile vector work | Yes | WRONG USER ABSTRACTION | **HIDE** from normal user |
| System verdict | Closeout | Deterministic preliminary warning outcome | Yes | ACCEPTABLE TECHNICAL TRANSPARENCY, poorly worded | **RENAME** to calculated review |
| Confidence columns | Database/domain | Fixed heuristic values | Weak; largely hidden | CORRECTLY HIDDEN INTERNAL CONCEPT | **KEEP HIDDEN**, later remove/redefine |
| Warning hit rate | Dashboard | Human-confirmed evaluated warning outcomes | Yes, no sample gate | POTENTIALLY MISLEADING CLAIM | **RENAME/CAVEAT** or hide at low sample |
| No material historical risks | Web and Excel | Completed review with zero findings | Backend yes; web state check faulty | PROFESSIONALLY USEFUL but currently MISLEADING in one state | **KEEP after P0 fix** |
| Semantic/vector/embedding | Backend; model name leaks in readiness UI | Search implementation | Yes | INTERNAL CONCEPT LEAKED INTO UI | **HIDE** |

There is no exposed chain-of-thought. Tool/cycle telemetry is operational metadata rather than hidden reasoning, but it remains unnecessary for an estimator.

## User-facing claims traced to evidence

| Claim | Actual source | Classification | Assessment |
|---|---|---|---|
| “3 comparable jobs” | Structured trusted-job candidate selection plus persisted retrieval evidence | TRUSTED MEMORY RETRIEVAL | Supported |
| “X of Y jobs overran” | `calculate_category_risk` result | DETERMINISTIC CALCULATION | Supported |
| Median/range/frequency | Persisted calculation evidence rendered by TypeScript | DETERMINISTIC CALCULATION | Supported |
| Evidence strength | Fixed rules over sample/comparable/missing counts | DETERMINISTIC CALCULATION | Supported, explicitly not probability |
| Verified lesson | Human-confirmed lesson plus trusted-memory eligibility | VERIFIED HUMAN INPUT | Supported |
| Historical pattern | Agent selects eligible evidence; code renders calculations | MODEL INTERPRETATION backed by evidence | Supported if presented as interpretation |
| Warning effectiveness | Confirmed finding outcomes over reconciled jobs | STRUCTURED DATABASE FACT + VERIFIED HUMAN INPUT | Supported; sample-size presentation needs restraint |
| No material historical risks | Valid completed output with zero findings | DETERMINISTIC RESULT | Supported by backend, incorrectly triggered by web UI |
| Attention score | `38/22/10` severity weights summed and capped at 100 | UNSUPPORTED / UNCLEAR | Remove |
| System closeout verdict | Fixed note/variance heuristic | DETERMINISTIC CALCULATION | Not a probability; wording should say so |
| Proposed lesson cause/impact | Deterministic heuristic proposal until confirmed | MODEL/HEURISTIC PROPOSAL | Trusted only after human verification |

The provenance boundary in `src/lib/agent/provenance.ts` is strong: findings must reference current-investigation calculation, job-inspection, and lesson-retrieval evidence. Backend code renders the numerical claims.

## Complete Supabase/Postgres application-table inventory

All listed child tables are organization-scoped through direct `organization_id`, RLS, compound tenant-safe foreign keys, or all three. Server-only RPCs protect privileged import, lifecycle, vector, and demo operations.

| Table | Category | Domain purpose | Main writer → readers | Tenant ownership / major relationships | Important lifecycle or constraint | Authoritative/Derived/Operational | User-visible? | Keep/Merge/View/Remove candidate | Reason |
|---|---|---|---|---|---|---|---|---|---|
| `organizations` | AUTH / TENANCY | Company workspace | Onboarding RPC → every tenant service | Root record; members and all domain rows depend on it | Controlled organization creation | Authoritative | Yes | **KEEP** | Root tenant boundary |
| `organization_members` | AUTH / TENANCY | User-to-company membership | Organization creation/admin → auth/RPC checks | FK to organization and `auth.users` | Unique membership identity | Authoritative | Indirect | **KEEP** | Membership and authorization |
| `estimates` | BUSINESS TRUTH | Bid revisions, lifecycle and submitted values | Import/lifecycle server RPCs → dashboard, preflight, closeout | Org-owned; revision/self links; linked from jobs and investigations | Immutable revision identity; DB-enforced transitions | Authoritative | Yes | **KEEP** | Commercial baseline and lifecycle |
| `estimate_lines` | BUSINESS TRUTH | Normalized estimate-revision financial facts | Import commit RPC → analytics/preflight/closeout | Compound FK to org+estimate | Frozen after investigation starts | Authoritative | Indirect | **KEEP** | Revision-specific financial truth |
| `jobs` | BUSINESS TRUTH | Completed-job identity, totals, origin, baseline and trust state | Historical/closeout RPCs → history, analytics, memory | Org-owned; optional source estimate | Origin/baseline/quarantine eligibility | Authoritative | Yes | **KEEP** | Historical outcome root |
| `job_estimate_lines` | BUSINESS TRUTH | Completed job’s comparison-baseline lines | Historical/closeout commit → scope/variance/calculations | Compound FK to org+job | Snapshot of intended comparison baseline | Authoritative snapshot | Yes | **KEEP** | Preserves historical baseline independently |
| `job_actual_lines` | BUSINESS TRUTH | Actual quantity, unit, cost, hours and structured dimensions | Historical/closeout commit → scope/variance/calculations | Compound FK to org+job | Missing data distinguished from explicit zero | Authoritative | Yes | **KEEP** | Actual outcome facts |
| `job_scope_reviews` | BUSINESS TRUTH | Immutable scope match/change/unreconciled decision | Import/closeout RPC → eligibility and comparison | Compound FK to org+job | Append-only; structured reconciliation rules | Authoritative human judgment | Yes | **KEEP** | Prevents false estimate-vs-actual conclusions |
| `lessons` | BUSINESS TRUTH | Proposed, confirmed and rejected lessons plus index metadata | Closeout/status server boundary → memory/preflight/UI | Compound FK to org+job | Confirmation depends on eligible source; embedding freshness tracked | Authoritative after confirmation; vector derived | Yes | **KEEP** | Independent human-verification lifecycle |
| `documents` | EVIDENCE / AUDIT | Durable private source/supporting files | Import/closeout staging commit → evidence views/tools | Org-owned; optional estimate/job parent | Private tenant path and source identity | Evidence | Yes | **KEEP** | Original source artifact |
| `findings` | EVIDENCE / AUDIT | Current preflight findings | Investigation result RPC → estimate UI/lifecycle | Org+estimate+investigation compound relationships | Mutable only before submission; bounded status | Evidence state | Yes | **KEEP** | Review action and current warning state |
| `finding_evidence` | EVIDENCE / AUDIT | User-facing evidence attached to findings | Investigation persistence → finding UI | Org+finding and source-job links | Tenant-safe evidence source identity | Evidence | Yes | **KEEP** | Professional explanation |
| `human_questions` | EVIDENCE / AUDIT | Persisted pause/resume questions and answers | Investigation/answer RPCs → Inbox/estimate/runtime | Org+estimate+investigation; optional finding | Resolution and answer state persisted | Evidence/workflow state | Yes | **KEEP** | Durable human-in-the-loop |
| `investigation_evidence` | EVIDENCE / AUDIT | Immutable search/inspection/calculation/document ledger | Server tool calls → output validator/audit | Org+investigation compound FK | Append-only and investigation-scoped references | Evidence | Internal | **KEEP BUT INTERNAL-ONLY** | Proves evidence was actually consumed |
| `submission_findings` | EVIDENCE / AUDIT | Frozen warning snapshot at submission | Lifecycle RPC → closeout/outcomes | Org+estimate+finding+investigation | Append-only immutable snapshot | Immutable evidence | Yes | **KEEP** | Prevents post-submission history rewriting |
| `finding_responses` | EVIDENCE / AUDIT | Dated estimator response and mitigation history | Response RPC → submission snapshot/outcome review | Org+estimate+finding | Append-only; frozen response snapshot at submission | Evidence | Yes | **KEEP** | Separates response history from warning mutation |
| `finding_outcomes` | EVIDENCE / AUDIT | Calculated and human-confirmed warning outcome | Closeout/confirm RPCs → Inbox/calibration | Org+job+finding; optional response link | Confirmation lock and reviewed-outcome rules | Evidence/business outcome | Yes | **KEEP** | Calibration and learning evidence |
| `lifecycle_events` | EVIDENCE / AUDIT | Commercial transition audit | Lifecycle RPC → estimate audit timeline | Org+estimate | Append-only transition event | Audit | Yes | **KEEP** | Lifecycle accountability |
| `import_line_provenance` | EVIDENCE / AUDIT | Source file/sheet/row/mapping/parser link per normalized line | Import commit RPC → job audit view | Org+review file and one target line | Exactly one target line shape; survives parser changes | Audit | Disclosure | **KEEP** | Financial traceability |
| `job_variances` | DERIVED DATA / PROJECTION | Persisted category comparison from canonical lines | Import/closeout database calculation → job/preflight | Org+job | Database recomputation; scope-aware use | Derived | Yes | **KEEP**; possible derived-query candidate | Persistence preserves reproducible closeout result |
| `job_search_documents` | SEARCH / INDEX | Canonical job-memory text, hash and vector | Memory worker/server RPC → semantic retrieval | Org+job and embedding-space relationships | Eligibility, hash/model/version freshness, non-browser writes | Derived search projection | Internal | **KEEP BUT INTERNAL-ONLY** | Search performance and freshness |
| `embedding_spaces` | SEARCH / INDEX | Tenant/provider/model/dimension identity | Server configuration → index/retrieval workers | Organization keyed | Provider/model/dimension compatibility | Operational/search config | Leaked partially | **KEEP BUT INTERNAL-ONLY** | Prevents incompatible vector spaces |
| `investigations` | OPERATIONAL STATE | Preflight attempt, lease, status, mode and telemetry | Preflight RPC/runtime → estimate/Excel/status APIs | Org+estimate compound relation | Lease, heartbeat, retry, waiting/completed/failed | Operational | Status indirect | **KEEP BUT INTERNAL-ONLY** | Pause/retry/concurrency lifecycle |
| `import_reviews` | OPERATIONAL STATE | Reviewed analysis contract, hashes, context, expiry and result | Preview server boundary → commit RPC | Org+user ownership | Staged/committed/expired/cleaned; idempotent result | Operational/audit | Indirect | **KEEP BUT INTERNAL-ONLY** | Binds preview to commit |
| `import_review_files` | OPERATIONAL STATE | Staged reviewed source artifacts and source-selection identity | Preview/staging → commit/provenance | Org+review; storage paths | Role/source-type shape, hash, worksheet/snapshot identity | Operational/evidence | Indirect | **KEEP BUT INTERNAL-ONLY** | Storage saga and exact-source binding |
| `memory_index_jobs` | OPERATIONAL STATE | Durable embedding work, desired hash, lease, retries/failure | Reconciliation/server worker → memory diagnostics | Org+job or org+lesson; embedding space | One job per source; CAS hash; lease/status | Operational | Status leaked | **KEEP BUT INTERNAL-ONLY** | Idempotent indexing recovery |
| `memory_reconciliation_runs` | OPERATIONAL STATE | Records reconciliation counts and failures | Memory reconciliation → diagnostics | Org; optional job | Retry/audit timestamps and result counts | Operational/audit | Internal | **KEEP BUT INTERNAL-ONLY** | Memory repair observability |
| `demo_seed_operations` | OPERATIONAL STATE | Atomic/idempotent demo seed/reset identity and status | Demo server RPC → demo UI/retries | Org+actor scoped | Reused logical seed; demo-only cleanup | Operational | Indirect | **KEEP BUT INTERNAL-ONLY** | Safe demo retry and cleanup |
| `estimate_source_bindings` | INTEGRATION STATE | Links workbook/source identity to estimate revision | Excel commit → later Excel checks | Org+estimate+review | Source identity, snapshot identity and adapter version | Operational integration | Indirect | **KEEP BUT INTERNAL-ONLY** | Repeat/revision semantics |
| `excel_integration_runs` | INTEGRATION STATE | Tracks snapshot, review, estimate and preflight status | Excel preview/check/status APIs → task pane | Org+user+review+estimate | Previewed/running/input/completed/failed; idempotency | Operational integration | Indirect | **KEEP BUT INTERNAL-ONLY** | Integration retry and observability |

Supabase-managed `auth` and Storage system tables are not included in the 30 application-table count.

### Table summary

```text
Total application tables:          30
Clearly justified:                 30
Mostly internal/operational:       12
Possible redundancy:                0
Possible derived/view candidates:   1 (job_variances, but persistence is justified)
Actual removal candidates:          0
```

Table count is not the issue. The product problem is that a few internal operational concepts are exposed in normal estimator screens.

## Apparent model overlaps that are intentional

- `estimate_lines` preserve a specific bid revision; `job_estimate_lines` preserve the completed job’s selected comparison baseline.
- `job_actual_lines` are a different kind of truth from either estimate-line table.
- `findings` are mutable review state; `submission_findings` are immutable submission evidence; `finding_outcomes` record what later happened.
- `investigation_evidence` is the raw immutable tool ledger; `finding_evidence` is the professionally presented evidence projection.
- `documents` are durable attachments; `import_review_files` are staged reviewed artifacts in an import transaction.
- `import_reviews` bind interpretation to commit; `estimate_source_bindings` identify recurring external sources; `excel_integration_runs` track a particular live workflow.
- `lessons` hold verified business knowledge; `job_search_documents` are replaceable vector projections.
- `investigations` run preflight; memory jobs/runs repair search projections. Their leases and retries are unrelated.

No table merge is currently justified merely to reduce schema size.

## Database-to-UI map

| UI page / feature | API or service | Domain objects | Database tables |
|---|---|---|---|
| Dashboard | `readStore`, calibration repository | Estimate, Job, Lesson, Finding | `estimates`, `jobs`, `lessons`, `findings`, `finding_outcomes` |
| Historical import | `/api/import/preview` → `/api/jobs/import` | ImportReview, Job, ScopeReview | `import_reviews`, `import_review_files`, `jobs`, job lines, `job_scope_reviews`, `job_variances`, `documents`, provenance |
| New estimate | Preview → `/api/estimates/review` → preflight | ImportReview, Estimate revision | `import_reviews`, `estimates`, `estimate_lines`, `documents`, provenance, `investigations` |
| Excel Margin Check | Excel preview/check/status APIs | Snapshot, source binding, revision, investigation | `import_reviews`, `import_review_files`, `estimate_source_bindings`, `excel_integration_runs`, `estimates`, `investigations` |
| Estimate detail | Estimate repository | Estimate, findings, questions, lifecycle | `estimates`, `findings`, `finding_evidence`, `human_questions`, `lifecycle_events` |
| Finding response | Finding response/status APIs | Finding, WarningResponse | `findings`, `finding_responses` |
| Submission | Lifecycle RPC | Estimate, submitted snapshot | `estimates`, `submission_findings`, `lifecycle_events` |
| Closeout | Closeout preview/commit RPC | Job, actuals, scope, outcome, lesson | `jobs`, job lines, scope reviews, variances, outcomes, lessons, documents, provenance |
| Inbox | `readStore` plus answer/confirm APIs | Question, outcome, lesson | `human_questions`, `finding_outcomes`, `lessons` |
| Memory | Memory readiness/reconcile service | Lesson, search document, indexing work | `lessons`, `job_search_documents`, `embedding_spaces`, memory jobs/runs |
| Job detail | Job/document/provenance repositories | Completed job | `jobs`, job lines, scope review, variances, lessons, documents, provenance |
| Demo | Demo server RPC | Demo jobs, estimate and preflight | `demo_seed_operations` plus demo-origin business records |

Several pages call `readStore()`, loading many tenant tables before filtering in application memory. It is workable for a small pilot, but page-specific queries should replace this before tenant histories become large.

## Internal complexity leaking into the product

| Concept | Audit result |
|---|---|
| Parser version | Correctly invisible |
| Import review hash/contract | Correctly invisible |
| Snapshot hash | Correctly invisible |
| Investigation IDs | Correctly invisible |
| Lease state | Correctly invisible |
| Line-level provenance | Appropriately available behind disclosure |
| Agent mode/Strands | Incorrectly exposed |
| Agent cycles/tool names | Incorrectly exposed |
| Embedding model | Incorrectly exposed |
| Index failure count | Admin-only concept shown to estimator |
| Memory reconciliation/rebuild | Admin responsibility exposed as user action |
| Vector values | Correctly invisible |
| Source hash/content version | Correctly invisible |
| Demo origin | Correctly visible |
| Reconciliation state | Correctly visible because it changes evidence eligibility |

## Current route inventory

| Route | Purpose | Accessible from navigation? | Dead or duplicative? | Admin/internal? | Still required? |
|---|---|---|---|---|---|
| `/` | Daily dashboard | Yes | No | No | Yes |
| `/preflight` | Estimate/lifecycle list | Yes | No; name is system-oriented | No | Yes |
| `/estimates/new` | New estimate/revision review | CTA | No | No | Yes |
| `/estimates/[id]` | Findings, lifecycle, questions and closeout | Linked | No | No | Yes |
| `/jobs` | Completed job history | Yes | No | No | Yes |
| `/jobs/new` | Historical completed-job import | Linked | No | No | Yes |
| `/jobs/[id]` | Completed-job evidence | Linked | No | No | Yes |
| `/memory` | Lessons plus memory infrastructure state | Yes | Some overlap with Inbox/Job History | Partly | Lessons yes; operations should move |
| `/inbox` | Pending professional judgments | Yes | No | No | Yes |
| `/integrations/excel` | Excel task pane | Office manifest/integration | No | No | Yes |
| `/integrations/excel/auth-complete` | Office auth return | No | No | Utility-only | Yes |
| `/login` | Authentication | Public | No | No | Yes |
| `/signup` | Registration | Public | No | No | Yes |
| `/onboarding` | Company creation | Redirect flow | No | No | Yes |
| `/error` | Safe error display | No | No | Utility-only | Yes |

No clearly abandoned user-facing route was found.

## Professional workflow map

| Real professional task | Margin Memory feature | Value added | User friction | Backend support | Verdict |
|---|---|---|---|---|---|
| Historical onboarding | Paired estimate/actual import | Creates usable verified history | High metadata/reconciliation burden | Very strong | Keep, streamline |
| Estimating | External Excel/estimating tool | Product avoids duplicating takeoff/pricing | None inside Margin Memory | Correct boundary | Keep external |
| Pre-submit review | Margin Check/preflight | Catches repeated mistakes | Moderate | Strong | Core |
| Evidence inspection | Finding plus source jobs | Explains interruption | Drill-down incomplete | Strong ledger underneath | Improve presentation |
| Submission | Reviewed/submitted lifecycle | Freezes bid truth | Small | Strong DB enforcement | Core |
| Win/loss | Outcome state | Connects bid to future result | Manual duplicate entry | Strong | Sync later |
| Execution | Start/complete buttons | Supplies milestones | Clerical duplicate | Strong state machine | Source externally later |
| Actuals | Closeout import | Connects estimate to result | Moderate | Strong | Core |
| Scope changes | Scope reconciliation | Separates change from estimating miss | Very high manual entry | Strong | Keep judgment, automate capture |
| Closeout | Outcomes and lessons | Closes learning loop | Several reviews | Strong | Core |
| Lessons | Confirm/reject proposal | Prevents hypotheses becoming truth | Low | Strong | Core |
| Future review | Trusted retrieval plus calculations | Reuses verified company experience | Low once history exists | Strong | Primary value |

## What Margin Memory should not own

Keep these responsibilities in established professional systems:

- **Excel, Accubid and McCormick:** takeoff, assemblies, formulas, pricing databases, labor extensions, markup, estimate editing and proposal creation.
- **Bluebeam:** plan review, measurement and drawing markup.
- **QuickBooks/accounting/job-cost systems:** ledger entries, invoices, payroll, posted costs and financial close.
- **Time-tracking/field systems:** employee time capture and labor posting.
- **Project-management systems:** scheduling, dispatch, daily logs, operational change-order workflow and customer communications.
- **CRM systems:** sales pipeline and customer management.

Margin Memory should consume the submitted baseline, warning response, outcome, approved change information and actuals; reconcile them; then produce evidence-backed review and verified lessons.

## Code dead-weight and obsolete-path findings

No major dead feature was found, but these deserve later cleanup:

- `saveEstimate`, `saveJob`, `closeoutEstimate`, `uploadDocument`, `quarantineJobMemory`, and `getMemoryDiagnostics` appear to have no production callers.
- `findings.question` overlaps conceptually with the current `human_questions` workflow and is not rendered.
- `confidence` remains on findings, lessons, submission snapshots and outcomes despite fixed heuristic values and no calibrated interpretation.
- Legacy `match_jobs` remains in SQL and tests, while the production investigation uses `match_trusted_jobs`.
- The old revoked `ensure_embedding_space` function is superseded by the server boundary.
- Old handcrafted seed findings/questions remain useful as test fixture material; the current demo route runs a real preflight.
- The closeout route constructs a job object with `dataOrigin:'production'` even for a demo estimate. Migration 021’s `propagate_demo_job_origin` trigger corrects it before insertion, so current trust is safe, but application intent should agree with database intent.

## Demo and sample-data audit

Demo behavior is sound:

- A fresh organization does not auto-seed.
- Demo creation is an explicit user action.
- Demo jobs and estimates use `data_origin='demo'`.
- The UI shows Demo separately from legacy/closed-loop source.
- Trusted-memory eligibility rejects every non-production origin.
- Database triggers propagate demo origin through revisions and closeout.
- Demo reset is organization-scoped and deletes only non-production-origin records.

Names such as Baker Office Renovation and Delta Dental TI belong to the canonical demo dataset when they have demo origin. Current UI distinguishes them from real legacy imports.

## Screenshots and browser evidence

Audit screenshot manifest: `/tmp/margin-memory-product-audit/README.md`

Actual application routes captured:

- `/tmp/margin-memory-product-audit/screenshots/fresh-workspace-signin.png`
- `/tmp/margin-memory-product-audit/screenshots/signup.png`
- `/tmp/margin-memory-product-audit/screenshots/excel-task-pane-signed-out.png`
- `/tmp/margin-memory-product-audit/screenshots/error-page.png`

Production component states captured in Chromium:

- `/tmp/margin-memory-product-audit/screenshots/historical-import-review-fixture.png`
- `/tmp/margin-memory-product-audit/screenshots/hard-import-error-fixture.png`
- `/tmp/margin-memory-product-audit/screenshots/partial-actual-review-fixture.png`
- `/tmp/margin-memory-product-audit/screenshots/closeout-scope-reconciliation-fixture.png`
- `/tmp/margin-memory-product-audit/screenshots/warning-outcome-review-fixture.png`

The component screenshots render real production components, but they are fixture states rather than authenticated route-to-PostgreSQL journeys.

Authenticated dashboard, estimate detail, finding, evidence, zero-finding, human-question, job-detail, memory, Inbox, demo and full closeout screenshots were not captured. The repository has no disposable local Supabase Auth/PostgREST environment, and the read-only constraint prohibited creating hosted tenant data.

```text
Excel host verification:
NOT RUN — compatible Excel host unavailable.
```

## Verification results

| Command | Result |
|---|---|
| `npm run verify` | **PASS** — production source verification |
| `npm run typecheck` | **PASS** after removing stale `.next/dev` generated declarations |
| `npm run lint` | **PASS** |
| `npm test` | **PASS** — 21 files, 350 tests |
| `npm run test:db` | **PASS** — 125 database checks; all 21 migrations applied from zero |
| `npm run build` | **PASS** — compiled, typed and generated the application routes |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome npm run test:browser` | **PASS** — 10 tests |
| `git diff --check` | **PASS** |
| `git status --porcelain` | **Clean after audit** |

The first concurrent typecheck/build attempt saw duplicate declarations from `.next/dev/types` and `.next/types`. Removing only the generated `.next/dev` directory and rerunning sequentially produced clean typecheck and build results. The build-generated change to `next-env.d.ts` was restored.

Browser coverage includes authentication boundaries, signed-out Excel task-pane behavior, and import/scope/outcome components. It does not prove a complete authenticated route-to-database journey.

## Product scorecard

| Area | Score | Reason |
|---|---:|---|
| Professional workflow fit | 8/10 | Strong estimate-to-outcome-to-lesson loop |
| Time to first value | 4/10 | Historical data setup is demanding |
| Recurring review simplicity | 6/10 | Web flow has metadata friction; Excel helps but is unverified |
| Historical import friction | 4/10 | Safe but administratively heavy |
| Closeout friction | 4/10 | Scope-change allocation is substantial manual work |
| Evidence clarity | 7/10 | Facts are grounded; drill-down does not expose all structured provenance |
| Estimator control | 9/10 | No autonomous pricing, submission or commercial action |
| Existing-tool compatibility | 6/10 | Excel path exists; actual/job-cost connectors do not |
| Trust/transparency | 8/10 | Strong backend; false zero-finding UI reduces score |
| AI-theater avoidance | 6/10 | Attention score and agent/runtime vocabulary remain |
| Information architecture | 6/10 | Memory and Preflight labels emphasize system concepts |
| Database/domain clarity | 8/10 | Many tables, but their responsibilities are mostly crisp |
| Operational complexity hidden | 5/10 | Index/model/rebuild/agent telemetry leaks to normal UI |

## Priority list

### P0

1. Require a successfully completed investigation before the web estimate page can display “No material historical risks found.” Show queued, running, waiting-for-human and failed states explicitly.

### P1

1. Remove the unsupported estimate attention score.
2. Hide Strands, agent mode, cycles, tool names and TypeScript implementation wording.
3. Move embedding model, indexing failures and memory rebuild actions into internal diagnostics.
4. Rename Preflight navigation to Estimates or Bids; make Lessons/Memory secondary.
5. Collapse clean import reports into a short readiness summary; show parser detail on demand.
6. Infer or reuse project metadata where safe, especially in Excel and historical import.
7. Integrate or import won/start/completed milestones instead of making Margin Memory an execution tracker.
8. Suggest approved-change allocations from source data and ask the estimator to confirm them.
9. Add a structured evidence drill-down for calculation, comparability and retrieved lessons.
10. Replace whole-tenant `readStore()` page loads with page-specific repository queries.

### P2

1. Add a QuickBooks/job-cost actuals connector.
2. Add focused Accubid/McCormick estimate-source adapters after real source validation.
3. Gate warning-effectiveness metrics behind meaningful sample sizes.
4. Add search/filtering for larger job and lesson histories.
5. Review unused exports, legacy RPCs, `findings.question`, and heuristic confidence columns.
6. Make application-level demo closeout origin agree with database-enforced origin.
7. Define cost-escalation treatment before presenting historical unit-cost comparisons.

### External validation required

- Apply and verify migrations 017–021 against the hosted Supabase project.
- Run a complete authenticated hosted user journey.
- Test the Office add-in in a real Excel host.
- Test with permitted real contractor estimate and job-cost exports.
- Conduct estimator sessions measuring time to first finding and closeout completion.

## What is actually missing

| Priority | Missing workflow |
|---|---|
| P0 | Truthful failed/running/zero-finding state on web |
| P1 | Low-friction historical onboarding |
| P1 | Actual/job-cost system ingestion |
| P1 | Full evidence drill-down |
| P1 | Automated lifecycle milestone intake |
| P1 | Exception-only closeout-change confirmation |
| P2 | Larger-history search/filtering |
| P2 | Operational diagnostics separated from estimator UI |
| DO NOT BUILD YET | Takeoff, proposals, scheduling, invoicing, payroll, dispatch, CRM or supplier catalogs |

## Final product judgment

If I were an experienced electrical estimator, the three reasons I would use Margin Memory during a real bid are:

1. It could remind me of a real mistake from comparable completed work immediately before I submit a similar bid.
2. Its financial claims come from preserved estimate/actual records and deterministic calculations that I can inspect.
3. It keeps me in control: it asks focused questions and never changes pricing or submits the bid.

The three reasons I might stop using it are:

1. Importing old history and reconciling closeout changes takes more time than the warnings save.
2. The interface asks me to understand agents, memory indexing and runtime details that have nothing to do with estimating.
3. A failed or unfinished review can currently look like a clean zero-finding result on the web page, damaging trust.

## Final verdict

**B. The core professional workflow is strong, but unnecessary UI/domain complexity is obscuring it.**

The architecture supports a coherent professional product. The next work should simplify the estimator’s experience around the existing trust machinery, starting with the false zero-finding state. Real contractor and real Excel-host validation remain necessary before making professional adoption claims.
