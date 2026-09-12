# Margin Memory — problem-space assessment

Research date: 2026-09-11. This assessment uses public sources and the repository implementation. No customer interviews or paid pilots were conducted.

## Product assessment

Margin Memory addresses a credible problem: small contractors struggle to bring lessons from completed jobs into the next bid. Its strongest proposition is a short, evidence-backed check against the contractor's own history immediately before submission.

The product's technical differentiation is the connection between a warning, source-backed historical facts, the estimator's response, and the eventual outcome. Deterministic calculations, provenance, immutable submission evidence, scope reconciliation, and human-confirmed lessons make that connection credible. Zero to three findings and focused questions suit a time-limited bid review.

Demand, data-maintenance tolerance, incremental value over existing job-cost reports, and willingness to pay remain unproven. More runtime infrastructure cannot answer those questions.

## Evidence and limits

| Source | Relevant signal | Limitation |
| --- | --- | --- |
| [Electrical subcontractor seeking a historical cost database](https://www.reddit.com/r/estimators/comments/1dpvpc9) | A practitioner explicitly wants company history to inform estimates. | One anecdote; no purchasing evidence. |
| [Preferred estimating method](https://www.reddit.com/r/estimators/comments/1ghes4p) | Estimators use history as a check alongside detailed estimates and current quotes. | Mixed trades; not representative. |
| [Cataloging historical data](https://www.reddit.com/r/estimators/comments/iwmfe0) | Practitioners describe weak feedback between estimating and operations. | Older anecdotes, mainly general contractors. |
| [Historical data software recommendations](https://www.reddit.com/r/estimators/comments/cdl2lp) | Spreadsheet users report data-entry and accessibility friction. | Older qualitative evidence. |
| [FMI labor productivity study](https://fmicorp.com/about/news/construction-labor-productivity-the-20-billion-opportunity) | Planning, coordination, and change-order problems are material construction concerns. | Broad, self-reported construction data; waste is not necessarily preventable by estimating. |
| [2024 Electrical Contractor software report](https://www.ecmag.com/docs/default-source/profile-reports/profile-topic-specific-reports/ec_2024_profile_breakout_communications-meters-devices-and-software.pdf?sfvrsn=fad637d0_9) | Contractors commonly perform estimating and job-cost analysis internally on computers. | Subscriber survey and limited software-section sample. |
| [2026 Profile of the Electrical Contractor](https://www.ecmag.com/docs/default-source/profile-reports/profile-toplines/2026-profile-of-the-electrical-contractor-topline-report.pdf?sfvrsn=2029ff09_5) | AI use or planned use indicates some openness to assisted workflows. | Intent is not adoption, accuracy, or willingness to pay. |
| [Estimate Tracking](https://estimatorsplaybook.net/2014/08/13/estimate-tracking/) | Practitioner guidance warns that scope changes distort profitability interpretation. | Guidance, not quantified research. |
| [Knowify job costing](https://knowify.com/job-costing-software/) | Existing products advertise budget/actual history, phases, and change orders. | Vendor claims establish overlap, not comparative effectiveness. |

Most evidence concerns US construction and cannot establish market size, accuracy, ROI, or fit in another country's practices.

## Repository response to identified risks

The product now separates original bid variance from approved scope changes; records warning responses and mitigation review; labels evidence coverage without presenting heuristic confidence as calibrated probability; and protects imports with preview/commit binding, provenance, idempotency, revision identity, resource limits, and incomplete-actual exclusion.

The remaining central uncertainty is customer workflow fit. Real exports still need validation for labor basis, cost-code structure, units, revisions, completeness, and scope. The closed loop also carries manual effort, so pilot observation must determine which steps users will actually maintain.

## Initial customer hypothesis

Start with small electrical contractors doing recurring commercial renovation or tenant-fit-out work, led by an owner-estimator who can access final actuals and notes. Repeated project conditions make comparison more plausible. Firms with no usable history need a cold-start path; highly unique projects require cautious evidence labels.

Suggested message: **Before you send the bid, check whether your own past jobs reveal a cost you are missing.**

## Validation sequence

1. Interview 5–8 target contractors about recent disappointing jobs, what was knowable before bid, where actuals live, and who owns closeout.
2. Import 10–20 comparable jobs where available using [CUSTOMER_IMPORT_VALIDATION_TASKS.md](CUSTOMER_IMPORT_VALIDATION_TASKS.md).
3. Hold out a later job and compare Margin Memory's preflight with the contractor's normal checklist before revealing actuals.
4. Measure preparation time, review time, useful warnings, irrelevant warnings, data/scope failures, and decisions changed.
5. Follow a live bid through closeout and test voluntary repeat use and paid-pilot intent.

Passing synthetic tests establishes safeguards, not product-market fit or customer-record compatibility.
