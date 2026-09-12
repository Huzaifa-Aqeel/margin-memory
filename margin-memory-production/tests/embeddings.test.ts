import {it,expect} from 'vitest'
import {embeddingConfig,embeddingRequest,parseEmbeddingResponse} from '../src/lib/embeddings/provider'
const titan='amazon.titan-embed-text-v1',cohere='cohere.embed-v4:0'
it('retains Cohere 1536 dimensions and separate corpus/query roles',()=>{
 expect(embeddingRequest(cohere,'text','search_query')).toMatchObject({input_type:'search_query',output_dimension:1536})
 expect(embeddingRequest(cohere,'text','search_document')).toHaveProperty('input_type','search_document')
})
it('uses Titan G1 fixed dimensions and only its supported request fields',()=>{
 expect(embeddingConfig({BEDROCK_EMBEDDING_MODEL_ID:titan})).toMatchObject({model:titan,dimensions:1536})
 expect(embeddingRequest(titan,'  electrical\n labor ','search_query')).toEqual({inputText:'electrical labor'})
 expect(embeddingRequest(titan,'electrical labor','search_document')).toEqual({inputText:'electrical labor'})
})
it('validates model-specific responses without accepting another model payload',()=>{
 const vector=Array(1536).fill(0.1)
 expect(parseEmbeddingResponse(titan,{embedding:vector,inputTextTokenCount:3})).toEqual(vector)
 expect(parseEmbeddingResponse(cohere,{embeddings:[vector]})).toEqual(vector)
 expect(parseEmbeddingResponse(cohere,{embeddings:{float:[vector]}})).toEqual(vector)
 expect(()=>parseEmbeddingResponse(titan,{embeddings:[vector]})).toThrow()
 expect(()=>parseEmbeddingResponse(cohere,{embedding:vector})).toThrow()
})
it('rejects incompatible models and malformed vectors',()=>{
 expect(()=>embeddingConfig({BEDROCK_EMBEDDING_MODEL_ID:'amazon.titan-embed-text-v2:0'})).toThrow()
 for(const value of [[1,2],Array(1536).fill(Infinity),Array(1536).fill('0.1')])expect(()=>parseEmbeddingResponse(titan,{embedding:value})).toThrow()
})
it('bounds Unicode inputs without broken characters and rejects empty text',()=>{
 const result=embeddingRequest(titan,'電'.repeat(10000),'search_document')
 expect(result).toHaveProperty('inputText')
 if(!('inputText'in result)||!result.inputText)throw Error('Missing Titan input')
 expect(Buffer.byteLength(result.inputText)).toBeLessThanOrEqual(8000)
 expect(result.inputText).toMatch(/^電+$/)
 expect(()=>embeddingRequest(titan,' \n ','search_query')).toThrow('must contain text')
})
