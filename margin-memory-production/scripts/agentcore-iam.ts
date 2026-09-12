import {existsSync,writeFileSync} from 'node:fs'
if(existsSync('.env.local'))process.loadEnvFile('.env.local')
const account=process.argv[2],region=process.env.AWS_REGION||'us-east-1'
if(!/^\d{12}$/.test(account||''))throw new Error('Usage: npm run agent:iam -- <AWS account ID>')
const model=process.env.BEDROCK_MODEL_ID;if(!model)throw new Error('Set BEDROCK_MODEL_ID first')
const resources=[`arn:aws:bedrock:*::foundation-model/${model.replace(/^(global|us|eu|apac)\./,'')}`]
if(/^(global|us|eu|apac)\./.test(model))resources.push(`arn:aws:bedrock:${region}:${account}:inference-profile/${model}`)
if(process.env.BEDROCK_EMBEDDING_MODEL_ID)resources.push(`arn:aws:bedrock:${region}::foundation-model/${process.env.BEDROCK_EMBEDDING_MODEL_ID}`)
const trust={Version:'2012-10-17',Statement:[{Effect:'Allow',Principal:{Service:'bedrock-agentcore.amazonaws.com'},Action:'sts:AssumeRole',Condition:{StringEquals:{'aws:SourceAccount':account},ArnLike:{'aws:SourceArn':`arn:aws:bedrock-agentcore:${region}:${account}:*`}}}]}
const policy={Version:'2012-10-17',Statement:[
 {Effect:'Allow',Action:['bedrock:InvokeModel','bedrock:InvokeModelWithResponseStream'],Resource:resources},
 {Effect:'Allow',Action:['ecr:GetAuthorizationToken'],Resource:'*'},
 {Effect:'Allow',Action:['ecr:BatchGetImage','ecr:GetDownloadUrlForLayer'],Resource:`arn:aws:ecr:${region}:${account}:repository/margin-memory-agent`},
 {Effect:'Allow',Action:['logs:CreateLogGroup','logs:CreateLogStream','logs:PutLogEvents','logs:DescribeLogStreams'],Resource:`arn:aws:logs:${region}:${account}:log-group:/aws/bedrock-agentcore/runtimes/*`},
 {Effect:'Allow',Action:['logs:DescribeLogGroups'],Resource:`arn:aws:logs:${region}:${account}:log-group:*`},
]}
writeFileSync('.agentcore-trust.json',JSON.stringify(trust,null,2),{mode:0o600});writeFileSync('.agentcore-policy.json',JSON.stringify(policy,null,2),{mode:0o600});console.info('Wrote scoped runtime IAM policy and trust files.')
