# Supplied corpus end-to-end validation — 2026-09-14

## Scope and evidence level

This run used the unmodified files in `/home/huzaifa-aqeel/Downloads/testing files`. The actual-cost workbooks identify themselves as **synthetic job-cost exports** and state that their amounts are synthetic rather than market benchmarks. This is a structurally realistic integration corpus, not a real contractor/customer-record validation set.

The test used a newly created, isolated hosted Supabase organization. It started with zero jobs, estimates, or lessons. No existing user organization was used. Four historical job pairs were sent through the real preview and commit routes, persisted in hosted PostgreSQL, reconciled, indexed with live Amazon Titan embeddings, retrieved through tenant-protected RPCs, and then used by the real Strands + Amazon Nova Lite preflight.

## General fixes prompted by the corpus

The changes are format-driven and contain no workbook, project, customer, filename, or test-pack special cases.

1. The spreadsheet analyzer now scans the first 100 nonempty rows for headers, supports separate labor/material/equipment/subcontract/other component amounts, combines field/shop/indirect labor-hour columns, and reconciles component extensions against a row total without double-counting either representation.
2. Explicit `Row Type`/`Line Type`/`Record Type` columns now distinguish detail, credit, subtotal, total, and grand-total rows. Aggregate rows are excluded while legitimate negative detail credits remain authoritative.
3. Formula-derived mapped numbers continue to use cached workbook values only and produce an explicit review warning. Margin Memory still does not evaluate Excel formulas.
4. Import-analysis hashes now canonicalize optional `undefined` object values exactly as JSONB persistence does. This fixed a real preview/commit rejection where the visible reports were identical but an omitted optional `completeness` property changed the hash.
5. The Strands tool contract now requires inspection of current estimate lines before risk calculation, requires comparable-job search evidence before a completed result, prevents exhaustive calculations for absent categories, bounds category/calibration investigation, and makes deterministic materiality explicit to the model and renderer.
6. Model-selected findings are removed when the cited deterministic result has fewer than two usable comparisons, fewer than two overruns above 5%, or a median variance no greater than 8%. A zero-overrun calculation can no longer become a warning.
7. Finding actions and human-question topics must be professionally relevant to the calculated cost category. An incompatible labor/supplier-pricing action falls back to a neutral category review; an irrelevant question cannot pause an investigation.
8. Exact lesson IDs and inspected job IDs returned by tools may be resolved only to persisted evidence from the current investigation. Fabricated, unsearched, uninspected, foreign-investigation, and cross-tenant references still fail closed.
9. The Bedrock smoke test uses a realistic 256-token output allowance. The previous 32-token allowance caused Nova to fail the smoke script itself before producing its required terminal response.

## Parser results for the supplied historical pairs

All source totals below were captured separately from detail and reconciled. All pairs had complete category and available cost-code/phase coverage. Each contained cached formula values, so each correctly required the existing cached-value acknowledgment before authoritative import.

| Historical job | Estimate rows / total / hours | Actual rows / total / hours | Pair result |
| --- | --- | --- | --- |
| Baker Office TI 2025 | 24 / $47,783.06 / 282.22 h | 24 / $54,645.26 / 359.60 h | Complete after explicit final-actual confirmation |
| Harbor Medical Suite 2025 | 24 / $58,808.64 / 344.95 h | 24 / $67,338.71 / 428.50 h | Complete after explicit final-actual confirmation |
| Ridge Warehouse Lighting 2025 | 18 / $67,405.80 / 293.80 h | 18 / $67,579.58 / 284.10 h | Complete after explicit final-actual confirmation |
| Union Bank Branch 2025 | 24 / $40,981.36 / 245.08 h | 24 / $42,703.13 / 257.30 h | Complete; estimate also surfaced its commercial-row review warning |

Baker and Harbor approved-change allocations from the supplied CSV were recorded separately from the immutable submitted baseline. The four commits returned eligible historical evidence, produced one indexed job memory row each, and an exact retry returned the same job rather than a duplicate.

## Hosted memory result

Before cleanup, the isolated workspace contained:

| Record | Count / state |
| --- | --- |
| Historical jobs | 4, all `final_submitted`, reconciled, trusted within the isolated test org |
| Job search documents | 4 indexed with Titan v1, 1536 dimensions |
| Confirmed lessons | 2 |
| Indexed confirmed lessons | 2 |
| Durable memory index jobs | 6 indexed, 0 failed |

The tenant-authenticated `match_lessons` RPC returned both eligible confirmed lessons. A generic `office retrofit` query scored about 0.11, below the configured 0.18 threshold; a concrete `occupied access restrictions labor productivity` query scored about 0.50. This proves index correctness and also shows that retrieval quality depends materially on query wording.

## Current-estimate preflight result

| Estimate | Final safe result | What was proved | Remaining concern |
| --- | --- | --- | --- |
| Pine Street Office | No finding | Comparable search was persisted; the model calculated only one selected comparable, so the deterministic two-comparison minimum suppressed the warning | The corpus expects a focused occupancy question and a stronger Baker/Harbor labor warning. This remains a retrieval/selection false negative. |
| Cedar Grove Office | No material historical risks | A previous model attempt to turn `0 of 3` material overruns into a finding was blocked permanently; later one-job labor evidence was also suppressed | Desired anti-false-alarm behavior is achieved, but contractor review is still needed. |
| Oak Medical | Persisted question, answer, resume, then a labor finding backed by 2 of 3 jobs | Human interruption was durable; final arithmetic and evidence refs came from persisted deterministic tools | The live run asked a supplier-pricing question even though the final material issue was labor. A permanent category/topic guard now prevents that mismatch, but this final guard was verified deterministically rather than through another paid live run. |
| Valley Warehouse LED | No material historical risks | Ridge was the relevant warehouse history; labor and material calculations showed no overrun | Desired zero-finding behavior was achieved. |

The first live run revealed two unsafe output-quality cases: Cedar produced a materials warning from a `0 of 3` overrun calculation, and a labor finding used a supplier-pricing action. Both are now blocked by deterministic server rendering and permanent regression tests. Live failures caused by total-token exhaustion and malformed evidence-reference identity remained explicit failed investigations; neither was converted to a successful zero-finding state.

## Edge-workbook results

| Fixture | Result |
| --- | --- |
| Formula v1 | 24 rows, $43,200.25; cached-formula warning |
| Formula v2 changed factor | 24 rows, $44,726.99; different material source state and cached-formula warning |
| Two candidate sheets | Blocked with explicit `worksheet_ambiguous`; neither sheet silently selected |
| Unrelated sheets/privacy | Only `Final Estimate` selected; `Customer Contacts` and `Payroll Private` were non-plausible and not normalized |
| Subtotals/rollups/credits | 5 detail rows, 3 rollups excluded, negative credit preserved, $14,875 reconciled |
| Source-total mismatch | Hard blocked because the control value `$99,999.99 (intentional mismatch)` is an unsupported financial number; it cannot be approved generically |

## Verification

Final verification for this working tree:

| Command | Result |
| --- | --- |
| `npm run verify` | Passed |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm test` | Passed — 391 tests in 25 files |
| `npm run test:db` | Passed — 128 tests, all 21 migrations from zero |
| `npm run build` | Passed |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome npm run test:browser` | Passed — 19 tests |
| Focused agent/provenance/tool suite | Passed — 21 tests |
| `npm run smoke:bedrock` | Live Nova Lite passed; live Titan v1 returned 1536 finite, nonzero dimensions |
| `git diff --check` | Passed |

`npm install` also passed and audited 618 packages. `npm audit` reports two moderate advisories inherited through ExcelJS 4.4.0's `uuid` dependency. The offered automated remediation downgrades ExcelJS across a breaking major version, so it was not used as a compatibility workaround.

## Isolated hosted-data cleanup

The run used organization `d28c8f05-3dbf-4411-bc8c-b5a54ffcd029`. Its staged source objects were removed and its dedicated test login was disabled. Direct organization deletion was correctly rejected by the database because production-origin investigation evidence is append-only. The remaining isolated relational records are inaccessible through that login and must be removed, if desired, through an explicit audited database-maintenance transaction scoped to this organization. The application triggers were not disabled or weakened to make test cleanup convenient.

## Pilot judgment

The ingestion, review binding, transaction, idempotency, memory-indexing, tenant boundary, evidence ledger, and human interruption mechanics are strong enough for a controlled pilot. The supplied corpus does **not** prove that warning relevance is ready for unsupervised professional reliance. Pine remains a meaningful false negative, and the only available workbooks are synthetic. A pilot should therefore be supervised and scored with an estimator using real, permissioned exports before Margin Memory is described as reliably catching the most important bid risks.

This is a **pilot validation requirement**, not a reason to replace the deterministic parser with an LLM. The corpus showed that deterministic parsing and evidence controls caught concrete structural and numerical issues; the remaining weakness is professional retrieval/selection quality, which requires real estimator judgment and holdout evaluation.
