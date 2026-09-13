# Agent runtime and demo safety

Migration 021 and the matching server code make the demo workflow explicit and recoverable. Demo data is never created on signup, navigation, or server startup. A user must choose **Explore sample data** in an otherwise empty workspace.

## Agent terminal states

Strands `AgentResult.structuredOutput` is optional because an invocation can stop before final structured output. Margin Memory now interprets the supported result contract before rendering:

- `toolUse` plus schema-valid structured output: completed; findings or a legitimate zero-finding result are persisted.
- `interrupt` plus a validated `margin_memory_human_question`: waiting for human; the bounded question is persisted and no final-output renderer runs.
- a budget/cancellation/other terminal reason without structured output, contradictory interrupt data, or malformed structured output: failed; the investigation error is persisted and can be retried.

The observed failure was reproduced with Strands 1.17.0 and Nova Lite: the invocation returned `stopReason: "limitTurns"`, `cycleCount: 8`, and no `structuredOutput`. The old runtime ignored `stopReason` and passed that absent optional field to `AgentOutputSchema.parse`. The schema remains strict; missing output is never treated as zero findings.

Human questions use the existing `request_human_input` tool, bounded action vocabulary, `human_questions` persistence, answer RPC, and queued follow-up investigation. The HTTP request does not wait for the estimator.

## Demo seed transaction

The demo core dataset is created by `seed_demo_workspace_server` in one PostgreSQL transaction. It creates all sample jobs, estimate/actual lines, variances, lessons, and the sample estimate, then records one organization-scoped `demo_seed_operations` row. Any core-row error rolls the transaction back.

Preflight is a separate recoverable step because it calls Bedrock outside PostgreSQL. `claim_demo_preflight_server` leases that step so concurrent clicks and retries cannot start duplicate work. A failure records `preflight_failed` and returns HTTP 202 with the existing sample estimate ID; a retry reuses the same dataset. A completed operation is returned idempotently without another preflight.

Every seeded job and estimate has `data_origin = 'demo'`. Revisions inherit a non-production origin, and a completed job derived from a demo estimate inherits it too. The canonical trusted-memory policy continues to reject any job whose origin is not `production`; this excludes its vectors, lessons, calculations, evidence, and warning calibration.

## Reset and old partial seeds

`DELETE /api/demo/seed` resolves the organization from the authenticated session and calls a service-only RPC. The RPC deletes only records with durable `data_origin = 'demo'`, including their dependent sample state. Production rows are outside every cleanup predicate and database regression tests prove they survive.

Jobs created by the pre-021 demo route already carry demo origin. Migration 021 also backfills the one bundled `Riverside Office – Level 3` sample estimate only when its complete fixture fingerprint matches: creator, organization, creation window, all eight demo-origin job names, failed preflight state, commercial metadata, assumptions, totals, and all four exact financial lines. A name alone can never classify an estimate as demo. After the migration, **Remove sample data** safely removes the complete old partial seed as well as new demo datasets.
