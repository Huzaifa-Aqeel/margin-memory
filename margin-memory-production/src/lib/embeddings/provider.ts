import {BedrockRuntimeClient,InvokeModelCommand} from '@aws-sdk/client-bedrock-runtime'
import {z} from 'zod'
export const EMBEDDING_DIMENSIONS=1536
const modelSchema=z.enum(['amazon.titan-embed-text-v1','cohere.embed-v4:0'])
export type EmbeddingModel=z.infer<typeof modelSchema>
export function embeddingConfig(env:Record<string,string|undefined>=process.env){
 if(env.EMBEDDING_PROVIDER&&env.EMBEDDING_PROVIDER!=='bedrock')throw new Error('Unsupported EMBEDDING_PROVIDER; migrate the memory index explicitly before changing providers')
 const result=modelSchema.safeParse(env.BEDROCK_EMBEDDING_MODEL_ID)
 if(!result.success)throw new Error('BEDROCK_EMBEDDING_MODEL_ID must be amazon.titan-embed-text-v1 or cohere.embed-v4:0 for the existing 1536-dimensional index')
 return{provider:'bedrock',model:result.data,dimensions:EMBEDDING_DIMENSIONS,region:env.AWS_REGION||'us-east-1'} as const
}
export function embeddingsEnabled(){return Boolean(process.env.BEDROCK_EMBEDDING_MODEL_ID)}
function embeddingText(text:string){
 const normalized=text.replace(/\s+/g,' ').trim()
 if(!normalized)throw new Error('Embedding input must contain text')
 // Bound UTF-8 bytes, not UTF-16 code units; retain complete Unicode characters.
 // This conservative bound stays below Titan G1's 8192-token input limit.
 let bytes=0;let result=''
 for(const character of normalized){bytes+=Buffer.byteLength(character,'utf8');if(bytes>8000)break;result+=character}
 return result
}
export function embeddingRequest(model:EmbeddingModel,text:string,inputType:'search_document'|'search_query'){
 const input=embeddingText(text)
 // G1 has a fixed 1536-dimensional output and accepts inputText only.
 if(model==='amazon.titan-embed-text-v1')return{inputText:input}
 return{texts:[input],input_type:inputType,embedding_types:['float'],output_dimension:EMBEDDING_DIMENSIONS,truncate:'NONE'}
}
export function parseEmbeddingResponse(model:EmbeddingModel,value:unknown){
 const vector=z.array(z.number().finite()).length(EMBEDDING_DIMENSIONS)
 if(model==='amazon.titan-embed-text-v1')return z.object({embedding:vector}).parse(value).embedding
 const parsed=z.object({embeddings:z.union([z.array(vector).length(1),z.object({float:z.array(vector).length(1)})])}).parse(value)
 return Array.isArray(parsed.embeddings)?parsed.embeddings[0]:parsed.embeddings.float[0]
}
export async function embedText(text:string,inputType:'search_document'|'search_query'){
 const config=embeddingConfig();const client=new BedrockRuntimeClient({region:config.region})
 const result=await client.send(new InvokeModelCommand({modelId:config.model,contentType:'application/json',accept:'application/json',body:JSON.stringify(embeddingRequest(config.model,text,inputType))}),{abortSignal:AbortSignal.timeout(30000)})
 return parseEmbeddingResponse(config.model,JSON.parse(new TextDecoder().decode(result.body)))
}
