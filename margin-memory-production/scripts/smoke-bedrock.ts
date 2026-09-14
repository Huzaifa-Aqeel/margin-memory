import {existsSync} from 'node:fs'
import {Agent,BedrockModel} from '@strands-agents/sdk'
import {embedText,embeddingConfig} from '../src/lib/embeddings/provider'
if(existsSync('.env.local'))process.loadEnvFile('.env.local')
// Check each configured service independently so model denial cannot hide an
// embedding configuration/access error. Never print credentials or model text.
const checks:[string,()=>Promise<void>][]=[['Agent model',async()=>{
 if(!process.env.BEDROCK_MODEL_ID)throw new Error('Set BEDROCK_MODEL_ID and configure AWS credentials first')
 const agent=new Agent({model:new BedrockModel({region:process.env.AWS_REGION||'us-east-1',modelId:process.env.BEDROCK_MODEL_ID,maxTokens:256}),printer:false})
 await agent.invoke('Reply with exactly OK and nothing else.',{limits:{turns:1,outputTokens:256},cancelSignal:AbortSignal.timeout(30000)})
}]]
if(process.env.BEDROCK_EMBEDDING_MODEL_ID)checks.push(['Embeddings',async()=>{
 const vector=await embedText('Electrical labor access','search_document')
 if(vector.length!==embeddingConfig().dimensions)throw new Error('Embedding dimensions mismatch')
 console.info(`Embedding response validated: ${vector.length} dimensions.`)
}])
for(const [name,run] of checks){try{await run();console.info(`${name}: PASS`)}catch(error){console.error(`${name}: FAIL — ${error instanceof Error?`${error.name}: ${error.message}`:'Request failed'}`);process.exitCode=1}}
