# Historical onboarding hardening — 2026-09-13

## Outcome

Historical completed-job onboarding now asks the estimator for decisions that affect commercial meaning and derives routine descriptive context from the selected source filenames when it can do so conservatively. It continues to use the existing spreadsheet parser, review contracts, transactional import RPC, immutable baseline identity, source provenance, scope reconciliation, and trusted-memory eligibility policy. No migration or second import path was introduced.

The resulting rule is:

```text
clean data      → concise review and three professional confirmations
ambiguous data  → only the unresolved worksheet or mapping is shown
unsafe data     → blocked without a continue-anyway path
```

Real customer-record compatibility has not yet been proven. The behavior in this document is established by synthetic fixtures, route/database tests, and browser component fixtures.

## Measured workflow

The baseline was measured with the existing paired historical-import form and safe synthetic files. No elapsed-time estimate was invented.

### Before

- Eight primary actions on the clean eligible path: select two files, choose a baseline, preview, acknowledge a generic warning, confirm final actual completeness, assess scope, and import.
- Two fields had to be typed even when filenames carried useful context: job name and completion date.
- Project and customer type used silent generic defaults.
- All seven metadata/context inputs, parser mappings, row diagnostics, and totals were visible before the source had been analyzed.
- The same actual-completeness limitation required both a generic acknowledgement and its specific professional confirmation.

### After

- Seven primary actions on the clean eligible path: select two files, explicitly confirm the suggested/selected baseline, analyze, confirm final actual completeness, assess scope, and import. File selection is counted as two actions.
- Zero required metadata fields need typing when the filenames contain the conservative context used by the fixture.
- Three professional decisions remain: baseline identity, actual-export completeness, and final scope relationship.
- Metadata appears only after a valid server analysis. Safe suggestions remain editable.
- Clean parser detail is collapsed behind **View source details**.
- A dedicated final-actual confirmation satisfies that exact ambiguity; the UI no longer asks for a second generic acknowledgement for the same issue.

## Metadata and decision classification

| Field or decision | Previous behavior | Current classification and behavior | Why this is safe |
| --- | --- | --- | --- |
| Estimate source | Required file selection | Required source artifact | It is the submitted/original commercial baseline under review. |
| Actual source | Required file selection | Required source artifact | Missing actual data is never inferred as zero. |
| Estimate baseline | Manual selection | **Required professional judgment**; a filename-based suggestion must be explicitly confirmed before analysis | Only explicit tokens such as `original`, `bid`, `final`, and `submitted` influence the suggestion. The review contract stores the confirmed value. Unknown remains available and limits evidence eligibility. |
| Job name | Required text | **Safe to suggest + confirm** from the common descriptive filename stem; editable | Generic source/export tokens and explicit dates are removed. Generic filenames yield no suggestion. Server commit rejects a missing name. |
| Project type | Visible generic default | **Safe to suggest + confirm** from a conservative keyword vocabulary; editable | No value is fabricated when filenames do not contain a recognized project context. Server commit rejects a missing value. |
| Customer type | Visible generic default | **Safe to suggest + confirm** only where a conservative public/residential/commercial signal exists; editable | Generic filenames remain blank. Server commit rejects a missing value. |
| Completion date | Required date | **Safe to suggest + confirm** only from an explicit valid ISO-style date in the actual filename; editable | File timestamps and today's date are not used as commercial truth. Server commit rejects a missing or invalid date. |
| Location | Always visible optional text | **Optional** behind disclosure; no inference | Filenames are not treated as reliable address evidence. |
| Tags | Always visible optional text | **Optional** behind disclosure; conservative context suggestions remain editable | Tags such as occupied, after-hours, and retrofit are descriptive; they do not alter financial normalization. |
| Notes / source notes | Always visible | **Optional** behind disclosure and reused in the same review contract | A selected notes file is staged and hashed with the reviewed sources. It is not requested again at commit. |
| Worksheet | Full report always visible | **Internal when one safe visible candidate exists; professional source selection when ambiguous** | The canonical parser still blocks ties, hidden-only workbooks, and split actuals. A selection triggers a new server analysis. |
| Column mapping | Full mapping always visible | **Internal when unambiguous; focused source-field choice when candidates compete** | The chosen one-based column index is validated server-side, stored in the review report, and reused by commit normalization. |
| Actual completeness | Specific plus generic acknowledgement | **Required professional attestation** when structural checks are otherwise complete | The dedicated confirmation cannot override detected category/code/phase/division gaps or hard blockers. |
| Scope relationship | Always required | **Required professional judgment** after safe source analysis | `no_changes`, adjusted allocations, and unreconciled scope retain their existing domain meaning and eligibility consequences. |
| Parser version, hashes, review contract, staging state | Visible indirectly through detailed import presentation | **Internal** | They remain enforced server-side and are not user decisions. |

## Clean import path

1. Select an estimate and a final actual/job-cost export.
2. Confirm what the estimate represents. Margin Memory may suggest a baseline from explicit filename language, but never accepts it silently.
3. Select **Analyze estimate and actuals**.
4. The server parses and stages the exact files, produces the canonical reports, and issues the existing SHA-256-bound review contract.
5. Review the concise estimate and actual summaries. Detailed worksheet, mapping, category, total, and excluded-row information remains available behind disclosure.
6. Confirm that the export is final and complete when the deterministic coverage assessment permits that attestation.
7. Confirm the scope relationship. Added/removed-scope allocation fields appear only when adjusted scope is selected.
8. Review or edit the suggested descriptive metadata, then select **Import completed job**.
9. The completion state reports source preservation, reconciliation, labor-comparison availability, and future Margin Check eligibility based on the canonical trusted-memory policy rather than database-commit success alone.

## Exception paths

### Ambiguous worksheet

Only plausible visible candidates are presented. The estimator selects the intended worksheet and re-analyzes. Hidden worksheets cannot be chosen, and split actual sheets still require a consolidated export.

### Ambiguous semantic mapping

Only the competing field is presented. For example, when both `Amount` and `Cost` are plausible, the estimator chooses a specific source column. The server validates the choice and writes it into a new review contract. Commit reparses with that exact stored column index; browser-supplied commit mapping is ignored.

### Partial actuals

The report names the missing coverage. It does not offer a final-complete confirmation when deterministic gaps exist. The estimator may archive the job after explicitly accepting the listed limitation and marking scope unreconciled, but the completion state states that it cannot be used for numerical historical evidence.

### Material scope change

Selecting adjusted scope reveals only the category allocations and approval references needed to reconcile the original bid to the work actually performed. The system does not infer that commercial judgment from a total difference.

### Hard-invalid source

Malformed financial values, failed total reconciliation, unsafe worksheet structure, and other hard blockers remain non-waivable. Metadata and import actions stay hidden until a safe analysis exists.

## Integrity and trust invariants

- Preview and commit use `IMPORT_PARSER_VERSION = 2026-09-p1-v2` and the same canonical normalization implementation.
- Worksheet and semantic-column resolutions produce a fresh server analysis and review contract.
- Commit loads server-owned worksheet and mapping selections; it does not trust browser report JSON.
- SHA-256 file binding, report hashing, tenant/user ownership, two-hour expiry, private source staging, and transactional commit remain unchanged.
- Source files and every normalized line retain existing document and line-level provenance.
- Baseline identity remains explicit and immutable. An unknown baseline is preserved as limited history rather than promoted to trusted evidence.
- Missing actual data remains distinct from a confirmed zero.
- Scope reconciliation remains required for authoritative numerical comparison.
- Idempotent replay checks the consumed review before parsing new metadata input and returns the original job. A retry or lost response does not create a second authoritative job.
- Demo and synthetic origins remain excluded by the existing trusted-memory policy.
- Tenant resolution and privileged commits remain server-side.

## Historical-evidence readiness

A committed historical job is eligible for future Margin Checks only when the existing canonical memory policy finds all of the following true:

- actual completeness is `confirmed_complete`;
- scope is reconciled as `no_changes` or `adjusted`;
- baseline is explicitly `original_bid` or `final_submitted`;
- origin is `production`;
- memory status is `trusted`.

The new completion presentation calls the same policy. Labor comparison is shown as available only when the job is eligible and both estimate and actual sources contain labor hours. If any requirement fails, the job remains an audit record and the UI lists the professional limitation instead of claiming historical readiness.

## Regression coverage

- Deterministic filename inference, generic-name fallback, invalid/missing metadata rejection, and tag normalization.
- Explicit baseline confirmation before paired analysis.
- Explicit semantic-column resolution and exact mapping parity through preview, commit, PostgreSQL rows, and line provenance.
- Dedicated final-actual confirmation without redundant generic acknowledgement.
- Missing metadata server rejection and idempotent replay behavior.
- Historical-evidence readiness for eligible, unknown-baseline, and incomplete-scope jobs.
- Browser flows for clean import, ambiguous worksheet, ambiguous mapping, partial actuals, hard blockers, generic filenames, adjusted-scope disclosure, and preservation of estimator edits across re-analysis.

## Screenshots

The screenshots are Playwright component-fixture captures. They verify application presentation logic, not a signed-in hosted Supabase session.

- Before: `docs/audit-assets/historical-onboarding-2026-09-13/before/clean-review.png`
- Clean review: `docs/audit-assets/historical-onboarding-2026-09-13/after/clean-review.png`
- Eligible completion: `docs/audit-assets/historical-onboarding-2026-09-13/after/eligible-completion.png`
- Worksheet resolution: `docs/audit-assets/historical-onboarding-2026-09-13/after/worksheet-resolved.png`
- Mapping resolution: `docs/audit-assets/historical-onboarding-2026-09-13/after/mapping-resolved.png`
- Partial actuals: `docs/audit-assets/historical-onboarding-2026-09-13/after/partial-actuals.png`
- Hard blocker: `docs/audit-assets/historical-onboarding-2026-09-13/after/hard-blocker.png`

## Verification

| Command | Result |
| --- | --- |
| `npm run verify` | Passed |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed, no warnings |
| `npm test` | 372 tests passed in 24 files |
| `npm run test:db` | 126 tests passed; all 21 migrations applied from zero |
| `npm run build` | Passed with Next.js 16.3.4; 17 static pages generated |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome npm run test:browser` | 19 tests passed |
| Focused metadata/spreadsheet/import-contract/memory-policy unit suite | 105 tests passed in 4 files |
| Focused import browser suite | 13 tests passed across historical onboarding, import preview, and scope review |
| `git diff --check` | Passed |

## Remaining friction and accepted limits

- Generic filenames require the estimator to enter descriptive metadata because the system will not fabricate it.
- Baseline identity, actual completeness, and scope remain human decisions. This is deliberate.
- Adjusted-scope category allocations and approval references remain manual professional attestations.
- Multi-sheet actual aggregation remains unsupported; users must provide a consolidated export.
- There is no batch historical-import exception queue yet.
- CSV remains UTF-8 only, the application uses cached workbook formula values, and it does not convert construction units.
- The project/customer inference vocabulary is deliberately conservative and will need refinement using permissioned real exports.
- Real contractor-record compatibility has not yet been proven.

## Verdict

**A. Historical onboarding is now exception-driven: clean jobs require little administration while ambiguous financial truth still requires professional review.**
