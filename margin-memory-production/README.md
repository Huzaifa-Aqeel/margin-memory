# Margin Memory

Before you send this estimate, Margin Memory checks whether you're repeating something that has cost you before.

Margin Memory helps small electrical contractors turn completed jobs into verified company memory. Import historical estimates, actuals and notes; review proposed lessons; then run an evidence-backed preflight on a new estimate. The agent chooses what deserves investigation. Deterministic TypeScript and persisted evidence determine what is true. Humans resolve questions and retain authority over pricing and commercial commitments.

## Architecture

- Next.js 16, TypeScript, desktop preflight and mobile-friendly Inbox.
- Supabase email/password Auth with cookie sessions, Postgres tenant policies, private Storage and 1536-dimensional pgvector memory.
- One server-side Strands investigator using Amazon Bedrock, with focused typed tools and an immutable investigation evidence ledger.
- Independent Bedrock embeddings using Titan G1 or Cohere Embed v4; provider/model identity prevents incompatible vector mixing.
- Atomic investigation leases, heartbeats and execution claims support recovery after process failure.
- Optional AgentCore HTTP runtime preserves the same identity, tools, evidence and lease boundaries.

The commercial lifecycle is enforced in database RPCs:

```text
draft → reviewed → submitted → won → in_progress → completed → learning_review → learned
                            ↘ lost
```

Submission snapshots preserve the bid lines, warnings and evidence. Closeout attaches actuals to the same estimate/job lifecycle. Every warning outcome and proposed lesson must be reviewed before learning is complete. Confirmed lessons and historical warning calibration inform future investigations.

## Run locally

Use Node 22.12+ and npm. Configure a Supabase project and AWS model access using [the deployment guide](docs/DEPLOYMENT.md).

```bash
npm install
cp -n .env.example .env.local
# Fill in Supabase settings and the desired Bedrock models.
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
npm run smoke:bedrock
npm run dev
```

The app is at `http://localhost:3000`. Supabase signup uses email/password with email confirmation as configured in the project. OAuth/social login is not configured in this repository.

`BEDROCK_MODEL_ID` selects the investigator model. `BEDROCK_EMBEDDING_MODEL_ID=amazon.titan-embed-text-v1` enables independent semantic memory. AWS credentials use standard SDK resolution, including profiles and IAM roles. OpenAI is not required or installed. Empty model settings select explicitly labelled deterministic development review and disable semantic indexing; configured provider failures are surfaced.

## Verify

```bash
npm install
npm ls
npm run verify
npm run typecheck
npm run lint
npm test
npm run test:db
npm run build
npm run test:browser
```

Vitest includes real PostgreSQL/pgvector tests, using disposable local clusters. Install PostgreSQL 18 and pgvector, or set `PG_BIN` to compatible installed binaries. Playwright requires Chromium (`npx playwright install chromium`) or an existing browser via `PLAYWRIGHT_CHROMIUM_EXECUTABLE`. The browser smoke checks authentication entry and unauthenticated protection; a configured Supabase project is needed for the full signed-in journey.

## Documentation

- [Architecture and trust boundaries](docs/ARCHITECTURE.md)
- [Security](docs/SECURITY.md)
- [Environment, local setup, production deployment, IAM and AgentCore commands](docs/DEPLOYMENT.md)
- [Current implementation status, verification, and next steps](docs/CONTINUATION.md)
- [Import integrity architecture and limits](docs/IMPORT_PRODUCTION_HARDENING.md)
- [Real customer-file validation protocol](docs/CUSTOMER_IMPORT_VALIDATION_TASKS.md)
- [Problem-space research and pilot hypothesis](docs/PROBLEM_SPACE_RESEARCH.md)

The local runtime and optional AgentCore adapter are implemented. Live Nova Lite and Titan embedding requests have passed. AgentCore deployment and the full hosted Supabase journey remain unverified.
