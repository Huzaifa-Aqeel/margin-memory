# AWS setup for local Margin Memory

Start with local Strands execution. No AgentCore runtime is needed yet. AWS console login alone does not configure SDK credentials on this machine.

## 1. Select the region and models

In the AWS console select US East (N. Virginia), `us-east-1`. Open Amazon Bedrock's model catalog. Check access to Amazon Nova Lite and Amazon Titan Embeddings G1 - Text. Titan G1 is the selected embedding model for this project; optional Cohere support remains available with its separate Marketplace prerequisites.

In `.env.local`, alongside the Supabase settings:

```dotenv
AWS_REGION=us-east-1
AWS_PROFILE=margin-memory
BEDROCK_MODEL_ID=us.amazon.nova-lite-v1:0
EMBEDDING_PROVIDER=bedrock
BEDROCK_EMBEDDING_MODEL_ID=amazon.titan-embed-text-v1
AGENT_RUNTIME=local
AGENTCORE_RUNTIME_ARN=
```

Nova Lite is an inexpensive starting point. The investigator model can be changed independently later. The implementation supports Titan G1 (amazon.titan-embed-text-v1) and Cohere v4 at exactly 1536 dimensions. Titan v2 has different supported dimensions and cannot be substituted. Apply migration 012 before Titan indexing. Equal dimensions do not make different model spaces compatible; an existing Cohere/OpenAI space requires an explicit reset/reindex.

## 2. Configure local credentials

Install AWS CLI v2 using [the official installer](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html). Confirm `aws --version` works.

If your account uses IAM Identity Center:

```bash
aws configure sso --profile margin-memory
aws sso login --profile margin-memory
```

Use the SSO start URL and region from your account's access portal, select the account/role, and choose `us-east-1` for the CLI's default service region. The SSO region itself may be different.

If you instead have an IAM user's access key:

```bash
aws configure --profile margin-memory
```

Enter that IAM user's access key ID and secret interactively; use `us-east-1` and `json` for region/output. Use a project-scoped IAM identity, not root-account access keys. Do not add both profile credentials and unrelated environment access keys; environment credentials can take precedence.

Verify identity:

```bash
aws sts get-caller-identity --profile margin-memory
```

The AWS SDK reads the named profile automatically. You do not need an OpenAI key or a Bedrock-specific API key.

## 3. Grant model invocation permission

Attach this policy to the IAM role/user used by that profile. Replace `YOUR_ACCOUNT_ID` with your 12-digit AWS account ID. For Identity Center, an administrator applies the equivalent permission-set policy.

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
    "Resource": [
      "arn:aws:bedrock:us-east-1:YOUR_ACCOUNT_ID:inference-profile/us.amazon.nova-lite-v1:0",
      "arn:aws:bedrock:*::foundation-model/amazon.nova-lite-v1:0",
      "arn:aws:bedrock:us-east-1::foundation-model/amazon.titan-embed-text-v1"
    ]
  }]
}
```

Cross-region inference also needs access to the target foundation models, hence the region wildcard scoped to Nova Lite. Organization service-control policies may restrict target regions. Marketplace subscription/first-use account setup is separate from these runtime invocation permissions; an administrator may need to complete it once in the console.

## 4. Verify the actual application path

From the repository directory:

```bash
export AWS_PROFILE=margin-memory
npm run smoke:bedrock
npm run dev
```

The smoke test loads `.env.local`, makes a real model request, then checks a real embedding response has exactly 1536 values. Do not claim success from `sts get-caller-identity` alone: that confirms credentials, not model access.

- Credential/profile error: configure or refresh the profile.
- AccessDenied: check the role policy, model/Marketplace access and organization policy.
- Resource/model or throughput error: check region and inference profile ID.
- Throttling: check the account's model quota.

After the smoke succeeds, run a real preflight and the signed-in closed-loop journey. AgentCore setup is optional and follows in [DEPLOYMENT.md](DEPLOYMENT.md).

References: [AWS SDK credentials](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/getting-your-credentials.html), [Nova model IDs](https://docs.aws.amazon.com/nova/latest/userguide/what-is-nova.html), [model access](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html), [Titan G1 request and response](https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-titan-embed-text.html).
