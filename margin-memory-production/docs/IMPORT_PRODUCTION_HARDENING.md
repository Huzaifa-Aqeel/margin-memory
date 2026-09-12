# Import production hardening

## Authoritative lifecycle

Spreadsheet imports use a durable review contract:

1. The authenticated preview route parses the uploaded bytes with `IMPORT_PARSER_VERSION`, resolves a visible worksheet and mapping, calculates SHA-256 for each file, and stages the private source objects in the tenant's `job-files` prefix.
2. Postgres stores the user, organization, import kind, business context, parser version, reports, issues, selected worksheet, file hashes, analysis hash, and a two-hour expiry in `import_reviews` and `import_review_files`.
3. Commit receives the files again, hashes them again, reloads the server-owned contract, reparses with the stored worksheet, and recomputes the analysis hash. Browser-supplied report JSON is never authoritative.
4. A service-role-only RPC rechecks the signed-in actor's membership, exact warning acknowledgements, review state, context, and expiry. It creates the business object, attaches the already-staged source documents, stores line provenance, and consumes the review in one PostgreSQL transaction.
5. A replay of the same review returns its first result. A different review may intentionally import the same file for a different job.

Failed staging removes objects already uploaded in that attempt. A failed database transaction leaves the review staged and retryable, with no visible business record. Expired, uncommitted objects are claimed with a database lease, deleted from Storage, and marked cleaned. Cleanup runs on the next authenticated preview for the organization; `claim_expired_import_files` and `finish_import_cleanup` are also the bounded recovery primitives for an operations worker.

## Source provenance

Every normalized estimate and actual line created by a reviewed import has one `import_line_provenance` row. It identifies the review, source file, worksheet, source row, resolved semantic mapping, original relevant cell values, normalization decisions, and parser version. The original private file remains the raw artifact. Job detail pages show the concise file/sheet/row trace behind a disclosure.

## Commercial baselines

Estimate revisions are immutable estimate records linked by `revision_group_id`, `parent_estimate_id`, and an increasing `revision_number`. A revision does not overwrite the original estimate, its lines, findings, or submission snapshot. Findings and submitted evidence already point to a specific estimate revision. Closeout continues to create a job whose `source_estimate_id` is the completed submitted estimate, so actual comparison uses that revision's immutable lines.

Legacy job imports require a baseline role: original bid, final submitted bid, or historical/unknown. This label records what the imported estimate represents; it does not invent a missing commercial history.

## Supported units and formulas

Actual and estimate lines retain quantity, original unit, normalized recognized unit, unit rate, labor hours, cost code, phase, and division when present. Recognized labels include EA, LF, FT, SF, CY, HR, DAY, LOT, and LS plus conservative aliases. Unknown units remain in `unit` with no `normalized_unit`. The application does not convert units or compare quantities across incompatible units.

Margin Memory does not evaluate Excel formulas. It reads cached workbook values. Cached numeric results require review; missing, error, or nonnumeric results in mapped numeric fields block import. A cached value may be stale, so the user must recalculate and save the workbook before upload.

## Encoding and resource limits

CSV support is UTF-8 (with or without BOM), LF/CRLF, comma/tab/semicolon dialects, quoted delimiters, escaped quotes, and multiline quoted fields. Invalid UTF-8, unclosed quotes, material row-width differences, and unexpected columns block. Windows-1252 and other encodings are unsupported and must be exported as UTF-8.

Limits are enforced before or during normalization:

| Resource | Limit |
| --- | ---: |
| Compressed file | 25 MB |
| XLSX expanded ZIP content | 128 MB |
| ZIP entries | 5,000 |
| Expanded/compressed ratio | 100:1 |
| Worksheets | 50 |
| Rows per sheet/CSV | 50,000 |
| Columns | 256 |
| Cells per workbook/CSV | 2,000,000 |
| Individual cell/field | 100,000 characters |

XLSX ZIP metadata is checked before ExcelJS loads the workbook. Encrypted and ZIP64 workbooks block. These controls bound common decompression and memory attacks; they do not prove that every malformed ZIP/parser CPU attack is impossible. Server request timeouts remain an additional operational boundary.

Only visible, plausible worksheets are automatic candidates. Multiple estimate candidates require an explicit worksheet selection and a new server analysis. Hidden sheets cannot be selected. Actuals that appear split across multiple job-cost worksheets require a consolidated export; Margin Memory does not silently merge them.

## Deployment order

Deploy `202609120017_import_production_hardening.sql`, then `202609120018_trusted_import_boundaries.sql`, with the matching web application. Pause imports during the migration. Migration 018 removes browser access to the legacy import/closeout write primitives and exposes membership-checking wrappers only to trusted server code. Confirm `SUPABASE_SECRET_KEY` is available only to the server because review creation, commit, and compatibility RPCs are service-role-only. No new environment variables are introduced.

Run the full repository suite before deployment, then perform one estimate, one historical pair, one closeout, one retry, and one expired-review cleanup in a non-production organization. Inspect the resulting documents and provenance rows before enabling pilot users.
