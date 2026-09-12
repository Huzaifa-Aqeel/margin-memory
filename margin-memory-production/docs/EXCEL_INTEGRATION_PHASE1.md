# Excel Margin Check — Integration Phase 1

## Pre-implementation audit

### REUSE

- `src/lib/spreadsheet.ts`: the single hardened worksheet selection, header/mapping, row classification, numeric normalization, reconciliation and provenance implementation.
- `src/lib/import-contract.ts`, `src/lib/documents.ts`, `src/app/api/import/preview/route.ts`: server-owned review contracts, source staging, SHA-256 identity, exact warning acknowledgement and expiry semantics.
- `src/lib/repository/store.ts` and migration 017 commit RPCs: tenant-checked transactional estimate creation, immutable revision numbering, line provenance and idempotent review replay.
- `src/lib/agent/preflight.ts` and `src/lib/agent/runtime.ts`: the existing investigation lease, Strands/deterministic runtime, trusted-memory retrieval and evidence-backed result persistence.
- Existing `estimates`, `investigations`, `investigation_evidence`, `findings`, `finding_evidence`, and `human_questions` records remain authoritative for result display and resume.
- `getCurrentWorkspace`/`getAuthenticatedSupabase`: Supabase session verification and organization resolution. Excel never supplies an authoritative organization or actor.

### MINIMUM MISSING BOUNDARY

- A typed `excel_live_snapshot` source artifact with a stable workbook-scope identity and a deterministic logical content hash.
- A way to feed that snapshot into the existing spreadsheet analyzer without fabricating XLSX byte identity.
- Source metadata on the existing import review/document records and one tenant-scoped binding from a stable Excel workbook scope to its latest immutable estimate revision.
- Authenticated preview/check/state routes and a thin Office task pane that captures only a selected visible worksheet table/range.
- An Office manifest generator and external deployment instructions.

### MUST NOT DUPLICATE

- Spreadsheet business interpretation, import blockers, review contracts, estimate persistence, revision semantics, preflight prompts/tools, numerical calculations, evidence validation, question persistence, trusted-memory policy, or tenant authorization.

## Implemented source contract

The final path is:

```text
selected visible Excel table/range
→ office-js-excel-live-v1 snapshot
→ canonical logical SHA-256
→ private staged source artifact
→ existing spreadsheet analyzer
→ existing import review contract
→ immutable estimate revision
→ existing preflight/investigation/evidence
→ task-pane findings, question, or zero-finding result
```

`src/lib/integrations/excel-snapshot.ts` defines the strict source artifact. It is not described as XLSX bytes. Office APIs do not provide the original workbook file, so the task pane captures only the reviewed visible table/range and the server stages that deterministic JSON artifact as the raw source evidence.

The canonical snapshot hash includes:

- adapter version;
- a client-side SHA-256 of the stable workbook location (query strings/fragments removed before hashing; the plaintext path is never sent);
- worksheet ID and name;
- selection kind, table identity, and reviewed range metadata;
- dimensions, raw cell values, and formula text.

Capture time and display-only formatting text remain in the archived artifact but do not affect logical identity. Relevant value/formula/scope changes do. An unrelated uncaptured worksheet cannot affect the hash because it is neither read nor transmitted.

Margin Memory does not evaluate Excel formulas. The Office host supplies the current cell result alongside formula text; the existing spreadsheet analyzer treats that result under its cached-workbook-value limitation and requires review. Missing, errored, or nonnumeric formula results in mapped numeric fields remain blockers.

## Review and revision binding

`POST /api/integrations/excel/preview` authenticates the user, resolves the organization server-side, computes the snapshot/source hashes, runs the existing analyzer, stages the artifact, and creates the existing durable import review. The review binds parser version, report, warnings, profile, worksheet/range, source identity, snapshot hash, user, and organization.

`POST /api/integrations/excel/check` recaptures and reanalyzes the current selected source. A stale snapshot, changed source identity, changed report, expired/foreign review, or hard blocker fails closed. Reviewable warning codes must match the reviewed contract exactly.

Migration 020 keeps one tenant-scoped binding from an Excel workbook scope to its latest estimate revision. The first reviewed snapshot creates revision 0. An unchanged snapshot/profile safely reuses that estimate. A material change creates the next immutable revision using the database-derived prior estimate as parent. A stale review cannot attach to a different baseline. Submitted and prior revisions are never overwritten.

Operational `excel_integration_runs` record actor, organization, adapter, capture/snapshot identity, review, estimate, status, and failure stage. These and source bindings have RLS enabled and no authenticated-browser table privileges.

## Task pane

The manifest adds **Margin Check** to Excel's Home ribbon. The task pane supports signed out, ready, inspection, source selection, exception review, running, human question, findings, zero findings, and safe error/retry states.

Only visible worksheet tables/ranges are offered. One named table on one visible worksheet is a bounded automatic source. A bare used range, multiple tables, or multiple visible worksheets requires an explicit choice before any cell data is transmitted. Hidden sheets are never captured. The add-in uses read-only Office APIs and the manifest requests `ReadDocument`; it never writes workbook cells, prices, formulas, quantities, markup, or proposal content.

Findings show at most three persisted results with Fact, Interpretation, Action, and evidence disclosure. Questions use the existing persisted human-question lifecycle and resume through the existing preflight. No browser-memory state is authoritative.

If a duplicate click or lost response encounters a live investigation, the task pane polls the authenticated estimate-state endpoint until the persisted result becomes a question, findings, zero findings, or a safe failure. Preflight failures are recorded on the operational integration run so a reload does not leave invisible correctness state in browser memory.

## Microsoft/Excel deployment

The add-in requires the existing Margin Memory web application on a public HTTPS origin. Generate a deployable manifest after the web origin is live:

```bash
OFFICE_ADDIN_ORIGIN=https://margin.example.com npm run excel:manifest
```

This writes `.generated/excel/manifest.xml`; generated output is ignored by Git. Sideload that manifest for development or deploy it through Microsoft 365 Integrated Apps/centralized deployment. The origin must serve the task pane and the two PNG icons, and must be allowed by Supabase Auth. The sign-in dialog redirects to `/integrations/excel/auth-complete` on the same origin.

Phase 1 uses the existing Supabase user identity. It does not require a Microsoft identity token or Entra app registration. A future marketplace submission or Microsoft-identity sign-in would have separate external registration/consent requirements.

## Host and pilot boundary

Browser/unit tests verify the task-pane contract, deterministic source logic, route behavior, Postgres persistence, revision/idempotency, and signed-out UI. They do not emulate Office host behavior. A real Excel desktop/web host and a permissioned contractor workbook remain required pilot checks.

The generated add-in-only XML manifest passes Microsoft's `office-addin-manifest` schema and acceptance validator. This validates manifest structure and declared host/API requirements; it does not validate live Office.js behavior.

Future estimate adapters such as Accubid can produce an explicit estimate-source artifact and enter this same review/commit boundary. QuickBooks/job-cost adapters belong to the distinct actual-source and closeout/reconciliation boundary. Neither is implemented here.
