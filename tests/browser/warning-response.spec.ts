import { test, expect } from '@playwright/test'
import { build } from 'vite'
import { fileURLToPath } from 'node:url'
let script=''
test.beforeAll(async()=>{
 const output=await build({configFile:false,logLevel:'error',define:{'process.env.NODE_ENV':JSON.stringify('production')},resolve:{alias:{'@':fileURLToPath(new URL('../../src',import.meta.url))}},esbuild:{jsx:'automatic'},build:{write:false,minify:false,lib:{entry:fileURLToPath(new URL('./fixtures/warning-response.tsx',import.meta.url)),name:'ResponseFixture',formats:['iife']}}})
 const outputs=Array.isArray(output)?output:[output]
 const chunk=outputs.flatMap(value=>'output' in value?value.output:[]).find(chunk=>chunk.type==='chunk')
 if(!chunk||chunk.type!=='chunk')throw new Error('Response fixture did not compile')
 script=chunk.code
})
test.beforeEach(async({page})=>{
 // localhost provides the secure context needed for real browser UUID generation.
 await page.goto('/login')
 await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>')
 await page.addScriptTag({content:script})
})
test('records a response and separately reviews a successful mitigation despite the condition not occurring',async({page})=>{
 await page.getByRole('button',{name:'Record decision and close finding'}).click()
 await expect(page.getByLabel('Warning response history')).toHaveCount(0)
 await page.getByLabel('Response to this warning',{exact:true}).selectOption('mitigation_completed')
 await page.getByLabel('What did you do or decide, and why?').fill('Booked shutdown before field work.')
 await page.getByLabel('External bid revision reference (optional)').fill('Workbook R2')
 await page.getByRole('button',{name:'Record decision and close finding'}).click()
 await expect(page.getByLabel('Warning response history')).toContainText('Mitigation completed')
 await expect(page.getByLabel('Warning response history')).toContainText('during draft')
 await expect(page.getByLabel('Warning response history')).toContainText('Workbook R2')
 await page.getByLabel('Did the warned condition occur?').selectOption('not_observed')
 await page.getByLabel('Did your mitigation help?').selectOption('helped')
 await page.getByLabel('Evidence for your assessment').fill('Field log confirms the shutdown avoided occupied-hours work.')
 await page.getByRole('button',{name:'Confirm warning assessment'}).click()
 await expect(page.locator('#root').getByRole('alert')).toContainText('completed mitigation')
 await page.getByLabel('Completed response being assessed').selectOption({label:'Booked shutdown before field work.'})
 await page.getByRole('button',{name:'Confirm warning assessment'}).click()
 await expect(page.getByText('Human assessment: mitigated')).toBeVisible()
 await expect(page.getByText('Condition: Not observed',{exact:true})).toBeVisible()
 await expect(page.getByText('Response: Helped, based on my review',{exact:true})).toBeVisible()
})
test('planned actions cannot prove mitigation and uncertainty remains visible',async({page})=>{
 await page.getByLabel('Response to this warning',{exact:true}).selectOption('mitigation_planned')
 await page.getByLabel('What did you do or decide, and why?').fill('Plan to book shutdown.')
 await page.getByRole('button',{name:'Record decision and close finding'}).click()
 await expect(page.getByLabel('Completed response being assessed').locator('option')).toHaveCount(1)
 await page.getByLabel('Did the warned condition occur?').selectOption('unknown')
 await page.getByLabel('Did your mitigation help?').selectOption('unknown')
 await page.getByLabel('Evidence for your assessment').fill('No field log confirms whether the action happened.')
 await page.getByRole('button',{name:'Confirm warning assessment'}).click()
 await expect(page.getByText('Human assessment: not evaluable')).toBeVisible()
 await expect(page.getByText('Response: Effect is uncertain',{exact:true})).toBeVisible()
})
