# Margin Memory V2 Product Spec

## Intended user

Owner-estimator or senior estimator at a small electrical contractor. They already estimate competently, often in spreadsheets/takeoff tools, and need historical company experience surfaced at the moment a new bid is reviewed.

## Platform

Desktop-first responsive web application. Desktop handles detailed preflight/evidence review. Phone-sized layouts support the human-judgment inbox and concise question resolution. No native mobile app is required for V2.

## Core job to be done

> Before I send this estimate, tell me whether I am repeating an expensive assumption or estimating pattern my company has already learned from.

## Screens

### Dashboard
Shows completed-job memory, open preflight risks, historical estimate miss, lessons awaiting verification, estimates needing attention, and recent completed jobs.

### Preflight queue
Lists estimates, bid value, labor, open findings, actual agent mode, and review state.

### Estimate preflight
Shows no more than three material findings. Each finding contains a claim, a deterministic rationale, an evidence-strength label with sample/data coverage, a recommendation, and links to supporting completed jobs. Evidence strength is a transparency label, not a calibrated probability. Human questions live alongside the preflight. Agent telemetry exposes tool names/cycle count, never hidden reasoning.

### Completed jobs
Provides estimate-vs-actual category variance, closeout notes, original private source files, and lessons retained from the job.

### Memory
Shows pending/confirmed lessons. Only estimator-confirmed lessons are embedded and retrievable by the agent. Includes a vector-memory rebuild operation.

### Inbox
Mobile-friendly list of agent questions needing professional judgment.

### Import completed job
Takes estimate XLSX/CSV, actual XLSX/CSV, project metadata, closeout text, and optional PDF/TXT/MD notes. The user previews the exact files, resolves import exceptions and identifies the commercial baseline. Staged sources, normalized lines, variances and line provenance commit atomically and retry idempotently.

### Review new estimate
Takes estimate XLSX/CSV, project metadata, assumptions/exclusions, and up to five project documents. The estimate can be an original bid or an explicit immutable revision. A review contract binds the exact private sources, worksheet, mapping and warnings before commit, then an investigation starts.

## Agent autonomy

Allowed:
- choose which historical searches are useful
- semantically retrieve completed jobs and confirmed lessons
- inspect individual completed jobs
- inspect uploaded project documents
- call deterministic risk/missing-category tools
- stop when evidence is sufficient
- ask the estimator for missing material facts

Not allowed:
- invent quantitative evidence
- modify estimate pricing
- submit bids
- contact customers
- convert unconfirmed model hypotheses into company memory

## Success measures

Primary product outcomes:
- useful warnings accepted/resolved by estimator
- repeated historical mistakes caught before submission
- estimate-vs-actual error over time
- number of confirmed lessons reused in later preflights
- low false-alarm burden (zero findings must be a normal result)

Do not optimize for number of model calls, tokens, findings, or time spent chatting.

## Closed-loop lifecycle (implemented)

A reviewed estimate is not thrown away after preflight. Margin Memory treats it as the durable commercial/job record:

`draft -> reviewed -> submitted -> won | lost -> in_progress -> completed -> learning_review -> learned`

Rules are enforced in Postgres, not only in the UI. Review cannot complete while findings/questions remain open; submission cannot happen before review; actuals cannot be imported before completion; post-submission preflight findings are frozen; and `learned` cannot be reached while warning outcomes or closeout lessons remain unverified.

For won work, final actuals are imported against the specific completed/submitted estimate revision. The closeout transaction creates a linked completed job, copies that immutable revision's lines, stores actuals/variances and provenance, proposes lessons, and creates one warning-outcome record per unique submitted finding. The user confirms or corrects each outcome and separately assesses mitigation where applicable. Confirmed outcomes feed the `get_warning_calibration` tool so future Strands reviews can adjust how aggressively to interrupt for that risk category; they are not presented as calibrated prediction accuracy.
