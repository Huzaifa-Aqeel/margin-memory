import {z} from 'zod'
export function agentCoreDeployment(image:string,role:string,env:Record<string,string|undefined>){
 z.string().regex(/^\d{12}\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com\/.+/).parse(image)
 z.string().regex(/^arn:aws(?:-[a-z]+)?:iam::\d{12}:role\/.+/).parse(role)
 const required=['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','SUPABASE_SECRET_KEY','AWS_REGION','BEDROCK_MODEL_ID'] as const
 const environmentVariables:Record<string,string>={}
 for(const key of required){const value=env[key];if(!value)throw new Error(`Missing ${key}`);environmentVariables[key]=value}
 for(const key of ['EMBEDDING_PROVIDER','BEDROCK_EMBEDDING_MODEL_ID'])if(env[key])environmentVariables[key]=env[key]
 return {agentRuntimeName:'margin_memory',agentRuntimeArtifact:{containerConfiguration:{containerUri:image}},roleArn:role,networkConfiguration:{networkMode:'PUBLIC'},protocolConfiguration:{serverProtocol:'HTTP'},lifecycleConfiguration:{idleRuntimeSessionTimeout:300,maxLifetime:3600},environmentVariables}
}
