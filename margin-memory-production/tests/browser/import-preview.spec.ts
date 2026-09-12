import { test, expect } from '@playwright/test'
import { build } from 'vite'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

let script=''
test.beforeAll(async()=>{
  const output=await build({configFile:false,logLevel:'error',define:{'process.env.NODE_ENV':JSON.stringify('production')},resolve:{alias:{'@':fileURLToPath(new URL('../../src',import.meta.url))}},esbuild:{jsx:'automatic'},build:{write:false,minify:false,lib:{entry:fileURLToPath(new URL('./fixtures/import-preview.tsx',import.meta.url)),name:'ImportPreviewFixture',formats:['iife']}}})
  const outputs=Array.isArray(output)?output:[output]
  const chunk=outputs.flatMap(value=>'output' in value?value.output:[]).find(chunk=>chunk.type==='chunk')
  if(!chunk||chunk.type!=='chunk')throw new Error('Import preview fixture did not compile')
  script=chunk.code
})
test.beforeEach(async({page})=>{await page.setContent(readFileSync(new URL('./fixtures/scope-form.html',import.meta.url),'utf8'));await page.addScriptTag({content:script})})
test('shows detected totals and requires explicit review of usable limitations',async({page})=>{
  const preview=page.getByLabel('Import preview')
  await expect(preview).toContainText('3 detail rows · $1,500 · 0 hours')
  await expect(preview).toContainText('header row 3 · 1 summary rows excluded')
  await expect(preview).toContainText('category → cost type')
  await expect(page.getByLabel('Import readiness')).toHaveText('not ready')
  await page.getByLabel('I reviewed these specific limitations and want to continue.').check()
  await expect(page.getByLabel('Import readiness')).toHaveText('ready')
})
test('blocks malformed numeric data without offering approval',async({page})=>{
  await page.getByRole('button',{name:'Blocked preview'}).click()
  await expect(page.getByLabel('Import preview')).toContainText('could not be interpreted')
  await expect(page.getByLabel('I reviewed these specific limitations and want to continue.')).toHaveCount(0)
  await expect(page.getByText('Correct the errors in the source file')).toBeVisible()
})
test('requires a specific final-actual confirmation in addition to generic review',async({page})=>{
  await page.getByRole('button',{name:'Complete actual preview',exact:true}).click()
  await expect(page.getByLabel('Import preview')).toContainText('Actual coverage: complete')
  await page.getByLabel('I reviewed these specific limitations and want to continue.').check()
  await expect(page.getByLabel('Import readiness')).toHaveText('not ready')
  await page.getByLabel('I confirm this is the final and complete actual-cost export, including every posted cost category and transaction.').check()
  await expect(page.getByLabel('Import readiness')).toHaveText('ready')
})
test('explains structured actual coverage gaps without offering completeness confirmation',async({page})=>{
  await page.getByRole('button',{name:'Incomplete actual preview'}).click()
  const preview=page.getByLabel('Import preview')
  await expect(preview).toContainText('Missing cost codes: 260200')
  await expect(preview).toContainText('Missing phases: TRIM')
  await expect(page.getByLabel('I confirm this is the final and complete actual-cost export, including every posted cost category and transaction.')).toHaveCount(0)
})
