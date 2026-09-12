# Deployment and verification

The repository includes a working local Strands/Bedrock execution path and an AgentCore HTTP adapter. Live Nova Lite and Titan G1 embedding requests passed on 2026-09-11 using the configured AWS profile. Hosted Supabase read-only checks passed; no existing embedding spaces were found. AgentCore deployment and the complete authenticated journey have **not** been verified.

## Environment

Copy `.env.example` to `.env.local`. Next loads this file automatically. CLI smoke/config scripts explicitly load it. Container runtimes receive environment variables through their deployment configuration.

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Real Supabase project URL; used by web and agent runtime. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser-safe Supabase key. |
| `SUPABASE_SECRET_KEY` | Server-only key for narrow trusted investigation RPCs. |
| `AWS_REGION` | Bedrock/AgentCore region, default `us-east-1`. |
| `BEDROCK_MODEL_ID` | Agent model/inference-profile ID; empty selects explicitly labelled deterministic development mode. |
| `EMBEDDING_PROVIDER` | `bedrock`; independent of the agent model. |
| `BEDROCK_EMBEDDING_MODEL_ID` | `amazon.titan-embed-text-v1` (selected) or `cohere.embed-v4:0`; empty disables semantic indexing. |
| `AGENT_RUNTIME` | `local` (default) or `agentcore`. |
| `AGENTCORE_RUNTIME_ARN` | Required when `AGENT_RUNTIME=agentcore`. |

Credentials use the standard AWS SDK chain. Use `AWS_PROFILE` locally if desired; use execution IAM roles in AWS. Never put AWS credentials or the Supabase secret in `NEXT_PUBLIC_*`. Testing-only variables: `PG_BIN` selects PostgreSQL binaries; `PLAYWRIGHT_CHROMIUM_EXECUTABLE` selects an existing browser.

For inexpensive development, try `BEDROCK_MODEL_ID=us.amazon.nova-lite-v1:0`. A stronger demo option is `global.anthropic.claude-sonnet-4-6`. Confirm model access, region availability, inference-profile policy and account quotas before selecting either. Nova Lite was verified in this account; the stronger example has not been tested. Strands supports [BedrockModel](https://strandsagents.com/docs/user-guide/concepts/model-providers/amazon-bedrock/). Cohere v4 supports [1536-dimensional embeddings and distinct corpus/query input types](https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-embed-v4.html).

## Local setup

Use Node 22.12+ and npm. From this repository directory:

```bash
npm install
cp -n .env.example .env.local
# Fill .env.local with your actual project settings and selected models.
```

Apply all twenty-one migrations in filename order with a current Supabase CLI:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push --dry-run
supabase db push
```

Migration 012 permits Titan G1 without resizing pgvector columns or mixing existing model spaces. Migration 011 changes the closeout RPC signature. Migrations 015 and 016 add actual-completeness enforcement and persisted cost-code/phase/division coverage. Migration 017 adds durable review contracts, staged sources, provenance, revision identity, idempotent commit RPCs, units, and cleanup leases. Migration 018 removes direct authenticated access to legacy import/closeout write primitives. Migration 019 adds trusted-memory eligibility, origin/quarantine state, vector source identity, durable indexing jobs, and service-only vector/lesson transitions. It clears legacy vectors whose source/model identity cannot be proven; run company-memory reconciliation after deployment. Migration 020 adds the Excel live-snapshot source identity, tenant-scoped revision binding, operational runs, and service-only commit checks. Migration 021 adds explicit estimate origin, atomic/idempotent demo creation, a leased demo-preflight step, and demo-only reset. Coordinate migrations 017–021 with the matching application rollout and pause imports/reviews during deployment.

## Excel add-in deployment

Deploy the web application to its final HTTPS origin first. Then generate the origin-bound Office manifest:

```bash
OFFICE_ADDIN_ORIGIN=https://margin.example.com npm run excel:manifest
```

The output is `.generated/excel/manifest.xml`. Sideload it in a test Microsoft 365 tenant or deploy it through Microsoft 365 Admin Center → Integrated apps. Confirm the HTTPS origin serves `/integrations/excel`, `/integrations/excel/auth-complete`, and `/integrations/excel/icon-{32,80}.png`. Add the same origin and auth-completion URL to Supabase Auth's allowed redirect URLs.

Phase 1 uses Margin Memory/Supabase authentication and does not request Microsoft Graph or workbook-write permission. No Microsoft app registration is needed for this authentication design. Microsoft marketplace submission, organizational deployment approval, supported Office versions, and tenant policy remain external setup. Validate Excel desktop and Excel web separately using a nonproduction organization before a contractor pilot.

A fresh project runs migration 001 with schema-qualified vector operators. Existing projects apply 006's forward repair as well as the new guards. Migration 006 expires preexisting in-flight reviews so they can be retried safely. Import/lifecycle behavior remains transactional.

In Supabase Auth, set the application Site URL, allow `http://localhost:3000`, and set the confirmation email link to:

```text
{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
```

Configure AWS credentials, verify access, and start:

```bash
aws sso login --profile YOUR_PROFILE
export AWS_PROFILE=YOUR_PROFILE
npm run smoke:bedrock
npm run dev
```

The smoke command makes a small real model request and, if configured, an embedding request. It fails on missing credentials, model access, dimensions or provider errors. It does not use sample model responses.

## Release checks

```bash
npm install
npm ls
npm run verify
npm run typecheck
npm run lint
npm test
npm run build
npm run test:browser
```

`npm test` includes real database tests. Install PostgreSQL 18 and pgvector first; binaries default to `/usr/lib/postgresql/18/bin`, or set `PG_BIN`. The tests create isolated clusters under the OS temporary directory and stop them afterward. `npm run test:db` runs only the database suite. The harness uses minimal Supabase-compatible role/auth/storage schemas, not a hosted Auth/PostgREST/Storage server.

Playwright exercises actual login/signup UI and unauthenticated route protection. Install its browser with `npx playwright install chromium`, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome`. Its default local Supabase URL/key only permit testing requests without a user session; no service or authenticated flow is mocked. A real signed-in journey remains a release prerequisite. The production browser smoke now passes route protection and mobile signup; src/proxy.ts must remain beside src/app.

`skipLibCheck` is explicitly false. TypeScript 5.9 remains pinned for Supabase WebAuthn declaration compatibility. The URLPattern polyfill supplies the missing Node 22/browser API types. Strands is a server external package so Next does not bundle optional, unused SDK plugins as mandatory dependencies. The real SDK imports are regression-tested.

## Standard production web deployment

1. Provision Supabase and apply the migrations/confirmation settings above.
2. Configure server secrets and an AWS role permitted to invoke the chosen model(s).
3. Run all release checks and `npm run smoke:bedrock` against the target account.
4. Build and run the Node container (or use an equivalent Node host):

```bash
docker build -t margin-memory-web .
docker run --rm --env-file .env.local -p 3000:3000 margin-memory-web
```

Put HTTPS and your domain in front of this service. Set Supabase Site URL/allowed redirects to that HTTPS origin. Both container files exclude `.env*`, generated secret-bearing deployment JSON, and local artifacts. For hosted platforms, preserve at least a 300-second request budget for preflight endpoints. The model invocation is bounded to 240 seconds; lease heartbeats continue while waiting.

5. Complete the signed-in release journey: signup → company → historical import → lesson confirmation → new estimate → review/questions → resolve findings → Reviewed → Submitted → Won → In progress → Completed → actuals on the same estimate → warning/lesson review → Learned. Check a second tenant cannot read or link the first tenant's records or files. Repeat the new-estimate review and confirm it can retrieve learned history.

## Optional AgentCore deployment

Supabase ownership remains unchanged. Next creates an investigation and invokes AgentCore with a short-lived Supabase access token, organization, estimate and investigation IDs. AgentCore ingress uses IAM/SigV4; inside the runtime the Supabase user and organization are verified again. Ordinary reads use that user's JWT. Privileged evidence writes use the runtime's server secret and recheck membership. No refresh token is forwarded. An execution claim prevents duplicate transport delivery; failures preserve leases for recovery.

The adapter implements [the HTTP contract](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-http-protocol-contract.html): port 8080, `/ping`, `/invocations`, JSON responses, ARM64 image. Every invocation uses a fresh investigator; no tenant conversation state is reused.

Prerequisites: current AWS CLI v2, Docker buildx/ARM64 support, account permission to create ECR/IAM/AgentCore resources and pass the runtime role, model/Marketplace access, and a configured Supabase project. The generator validates inputs and writes secret-bearing files with mode 0600; it never prints their contents.

```bash
export AWS_REGION=us-east-1
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export AGENT_IMAGE="$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/margin-memory-agent:demo"
export AGENT_ROLE="arn:aws:iam::$AWS_ACCOUNT_ID:role/margin-memory-agent-runtime"

aws ecr create-repository --repository-name margin-memory-agent --region "$AWS_REGION"
aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"
docker buildx build --platform linux/arm64 -f Dockerfile.agentcore -t "$AGENT_IMAGE" --push .

npm run agent:iam -- "$AWS_ACCOUNT_ID"
aws iam create-role --role-name margin-memory-agent-runtime --assume-role-policy-document file://.agentcore-trust.json
aws iam put-role-policy --role-name margin-memory-agent-runtime --policy-name MarginMemoryRuntime --policy-document file://.agentcore-policy.json

npm run agent:config -- "$AGENT_IMAGE" "$AGENT_ROLE"
aws bedrock-agentcore-control create-agent-runtime --region "$AWS_REGION" --cli-input-json file://.agentcore-runtime.json --query '{id:agentRuntimeId,arn:agentRuntimeArn,status:status}'
```

Set `AGENT_RUNTIME_ID` to the returned ID. Wait until `get-agent-runtime` reports READY, then apply the required MMDSv2 update:

```bash
aws bedrock-agentcore-control get-agent-runtime --agent-runtime-id "$AGENT_RUNTIME_ID" --region "$AWS_REGION" --query status
npm run agent:config -- "$AGENT_IMAGE" "$AGENT_ROLE" "$AGENT_RUNTIME_ID"
aws bedrock-agentcore-control update-agent-runtime --region "$AWS_REGION" --cli-input-json file://.agentcore-update.json --query '{id:agentRuntimeId,arn:agentRuntimeArn,status:status}'
aws bedrock-agentcore-control get-agent-runtime --agent-runtime-id "$AGENT_RUNTIME_ID" --region "$AWS_REGION" --query '{status:status,metadata:metadataConfiguration}'
```

Do not invoke until READY and `requireMMDSV2=true`. AWS documents this requirement in [runtime troubleshooting](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-troubleshooting.html) and supports it in [UpdateAgentRuntime](https://docs.aws.amazon.com/bedrock-agentcore-control/latest/APIReference/API_UpdateAgentRuntime.html).

Grant the Next application's IAM role `bedrock-agentcore:InvokeAgentRuntime` on the returned runtime ARN and its endpoint ARN (`RUNTIME_ARN/runtime-endpoint/DEFAULT`). Runtime IAM grants model invocation, image retrieval and runtime logging; see [AWS execution-role requirements](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-permissions.html). Cross-region model profiles require both the profile and target foundation-model ARNs. The deployer additionally needs IAM/ECR/AgentCore creation/update and `iam:PassRole`; those are not runtime permissions.

Set in the **web** deployment:

```dotenv
AGENT_RUNTIME=agentcore
AGENTCORE_RUNTIME_ARN=THE_RETURNED_RUNTIME_ARN
```

Run a real preflight through the application and confirm its persisted investigation/ledger/findings and subsequent human-answer rerun. If remote execution fails, the UI reports failure rather than silently invoking a different runtime. Set `AGENT_RUNTIME=local` to return to the already-supported local Bedrock runtime.

For local adapter inspection:

```bash
npm run agent:serve
curl http://localhost:8080/ping
```

A real `/invocations` request needs an existing leased investigation and a valid Supabase access token. The test suite checks malformed requests without fabricating authentication success.

## Embedding migration and costs

Legacy vectors are tagged `openai/text-embedding-3-small`. Bedrock indexing refuses to mix with them. In a maintenance window, an administrator must transactionally clear the organization's lesson embeddings, delete its job search documents and embedding-space row, then use Memory → Update company memory with the new model configured. Back up first; this deletes only derived vectors, not jobs, lessons, findings or evidence. Pausing reviews/indexing during that administrative operation prevents in-flight old-provider writes. No automatic model switch is attempted.

AgentCore adds compute/session and logging costs to Bedrock model and embedding requests. Short idle timeouts, bounded model tokens/turns and small test imports limit spend. Cohere Embed v4 is billed through AWS Marketplace; **verify whether hackathon credits cover that Marketplace charge** before enabling it. [AWS model/billing details](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-cohere-embed-v4.html). Supabase, storage, ECR and network costs remain separate. No credit coverage or account model access was assumed.

## Known limits

- Live Nova Lite/Titan invocation passed. AgentCore deployment and the full authenticated Supabase journey remain unverified.
- The PostgreSQL harness does not test hosted Storage HTTP uploads, email delivery or token refresh.
- Reviews are bounded synchronous requests, with recoverable leases; there is no scheduled background queue/retry worker.
- Historical fact corrections require explicit new imports/estimates; an in-place revision editor is not implemented.
- The current dependency audit reports the existing ExcelJS → uuid advisory. ExcelJS uses UUID v4, while the advisory concerns v3/v5/v6 buffer APIs. No forced downgrade or incompatible override was applied. Monitor the upstream fix before broad rollout.
