import {it,expect} from 'vitest'
import {URLPattern} from 'urlpattern-polyfill'
import {Agent,BedrockModel} from '@strands-agents/sdk'
import {StrandsAgentOutputSchema} from '../src/lib/agent/provenance'
it('uses an actual URLPattern implementation for declared platform input',()=>{const pattern=new URLPattern({pathname:'/estimates/:id'});expect(pattern.exec('https://example.test/estimates/abc')?.pathname.groups.id).toBe('abc')})
it('loads the Bedrock investigator without OpenAI or optional S3 integrations',()=>{const model=new BedrockModel({region:'us-east-1',modelId:'amazon.nova-lite-v1:0'});const agent=new Agent({model,printer:false,structuredOutputSchema:StrandsAgentOutputSchema});expect(agent).toBeInstanceOf(Agent)})
it('bounds build concurrency without disabling TypeScript validation',async()=>{
 const {default:config}=await import('../next.config')
 const {readFileSync}=await import('node:fs')
 expect(config.experimental?.cpus).toBeGreaterThan(0)
 expect(config.experimental?.cpus).toBeLessThanOrEqual(2)
 expect(config.typescript?.ignoreBuildErrors).not.toBe(true)
 expect(JSON.parse(readFileSync('tsconfig.json','utf8')).compilerOptions.skipLibCheck).toBe(false)
})
