# Customer import validation protocol

The repository has broad synthetic parser and database coverage, but **real customer-record compatibility has not yet been proven**. Use this protocol before making compatibility or accuracy claims.

## Pilot corpus

For each consenting contractor, collect deidentified original-estimate and final job-cost exports for 10–20 reasonably comparable completed jobs where available. Record:

- source system and version;
- export type and estimate/actual role;
- whether an anonymized regression fixture is permitted;
- commercial baseline: original bid, revision, final submitted bid, or unknown;
- mapping corrections and unsupported fields;
- worksheet choice and excluded rows;
- source-total reconciliation;
- actual completeness and scope assessment;
- manual review decisions and final import result.

Never modify the originals. Store approved fixtures only after deidentification and explicit permission; label each fixture as synthetic, derived/anonymized real export, or real pilot export.

## Contractor verification

Have the contractor verify for every estimate/actual pair:

1. original or submitted budget and final actual total;
2. labor hours versus labor dollars and loaded versus base labor basis;
3. category, cost-code, phase, and division mappings;
4. scope alignment and approved changes;
5. excluded totals, overhead, tax, markup, and commercial rows;
6. quantities, units, credits, and incomplete actuals;
7. calculated category variances against their trusted report;
8. the chosen revision and worksheet are the intended commercial baseline.

Track preparation time, blocking errors, warnings, required mapping changes, and discrepancies. Hold out at least one later completed job: run preflight using only information available before its bid, compare with the contractor's normal review, then reveal its actuals.

## Current import safeguards

Preview and commit share the same parser and resolved mapping. A durable review contract binds exact file hashes, parser version, import type/context, worksheets, mappings, reports, warnings, user, and organization. Commit reparses the supplied bytes and attaches the previously staged private source files in the same database transaction as normalized facts and provenance. Safe retries return the original result.

The report exposes selected/candidate worksheets, header row, mappings, imported and excluded rows with reasons, malformed cells, category and labor-hour coverage, structured dimensions, source and normalized totals, reconciliation, and actual completeness. Hard blockers cannot be approved. Ambiguous visible worksheets can be selected explicitly and previewed again; hidden sheets and apparent split actuals remain blocked.

Numeric input accepts unambiguous US-formatted values. Unsupported locales, unit suffixes in numeric columns, letter substitutions, spreadsheet errors, malformed grouping, conflicting signs, invalid UTF-8, and Unicode replacement characters block. Source totals use the documented bounded rounding/review policy. Excel formulas rely on cached workbook values and require review; missing/error/nonnumeric caches block.

Category presence uses source transactions rather than only net totals. Missing categories or structured cost-code/phase/division coverage remain incomplete. An incomplete job may be archived as unreconciled but is excluded from numerical evidence, semantic indexing/retrieval, automated lessons, warning calibration, and finding evidence.

See [IMPORT_PRODUCTION_HARDENING.md](IMPORT_PRODUCTION_HARDENING.md) for exact limits and [CONTINUATION.md](CONTINUATION.md) for current verification.

## Pilot decision

Continue when customers can supply data, identify useful incremental findings, return voluntarily, and show willingness to pay. Narrow or reconsider the product if data preparation overwhelms the benefit, warnings remain generic, or normal review catches the same issues just as quickly.
