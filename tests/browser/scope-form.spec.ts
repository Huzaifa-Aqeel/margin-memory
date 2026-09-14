import { test, expect } from '@playwright/test'
import { build } from 'vite'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

// Mount the real shared components and validation in a browser. This fixture has
// no authentication/database substitutes and creates no production test route.
let script = ''
test.beforeAll(async () => {
  const output = await build({ configFile: false, logLevel: 'error',
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    resolve: { alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) } },
    esbuild: { jsx: 'automatic' },
    build: { write: false, minify: false, lib: { entry: fileURLToPath(new URL('./fixtures/scope-form.tsx', import.meta.url)), name: 'ScopeFixture', formats: ['iife'] } },
  })
  const outputs = Array.isArray(output) ? output : [output]
  const chunk = outputs.flatMap(value => 'output' in value ? value.output : []).find(chunk => chunk.type === 'chunk')
  if (!chunk || chunk.type !== 'chunk') throw new Error('Scope fixture did not compile')
  script = chunk.code
})
test.beforeEach(async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setContent(readFileSync(new URL('./fixtures/scope-form.html', import.meta.url), 'utf8'))
  await page.addScriptTag({ content: script })
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)))
  expect(errors).toEqual([])
})
test('requires assessment, validates allocations and shows original versus approved scope', async ({ page }) => {
  await page.getByRole('button', { name: 'Check scope', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Scope reconciliation' })).toHaveCount(0)
  await page.getByLabel('Does the final work match the original estimate scope?').selectOption('adjusted')
  await page.getByLabel('Approval reference').fill('CO-1 signed')
  await page.getByLabel('Approved scope', { exact: true }).fill('Additional circuits')
  await page.getByLabel('Approved cost budget change ($)').fill('50')
  await page.getByLabel('Approved hours change', { exact: true }).fill('5')
  await page.getByLabel('Actual cost for this change ($)').fill('151')
  await page.getByLabel('Actual hours for this change', { exact: true }).fill('5')
  await page.getByRole('button', { name: 'Check scope', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('exceed')
  await page.getByLabel('Actual cost for this change ($)').fill('50')
  await page.getByRole('button', { name: 'Check scope', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Scope reconciliation' })).toBeVisible()
  await expect(page.getByText('Original cost budget', { exact: true }).locator('..')).toContainText('$100')
  await expect(page.getByText('Scope-adjusted cost budget', { exact: true }).locator('..')).toContainText('$150')
  await expect(page.getByText('Actuals allocated to changes', { exact: true }).locator('..')).toContainText('$50')
  await expect(page.getByText('Remaining original-scope actuals', { exact: true }).locator('..')).toContainText('$100')
})
test('adds and removes categories and clears them when choosing unknown scope', async ({ page }) => {
  await page.getByLabel('Does the final work match the original estimate scope?').selectOption('adjusted')
  await page.getByRole('button', { name: 'Add scope change / category' }).click()
  await expect(page.getByRole('group', { name: /Scope change/ })).toHaveCount(2)
  await page.getByRole('button', { name: 'Remove scope change 2' }).click()
  await expect(page.getByRole('group', { name: /Scope change/ })).toHaveCount(1)
  await page.getByLabel('Does the final work match the original estimate scope?').selectOption('unreconciled')
  await expect(page.getByRole('group', { name: /Scope change/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Check scope', exact: true }).click()
  await expect(page.getByText('Scope has not been reconciled.', { exact: false })).toBeVisible()
  await expect(page.getByText('Scope-adjusted cost budget', { exact: true })).toHaveCount(0)
  await expect(page.locator('input[name="scopeReview"]')).toHaveValue('{"status":"unreconciled","changes":[]}')
})
test('fills the existing reviewed allocation fields from spreadsheet paste', async ({ page }) => {
  await page.getByLabel('Does the final work match the original estimate scope?').selectOption('adjusted')
  await page.getByText('Paste scope changes from a spreadsheet').click()
  await page.getByLabel('Pasted scope changes').fill('Reference\tDescription\tCategory\tBudget cost\tBudget hours\tActual cost\tActual hours\nCO-7\tNight access\tlabor\t50\t5\t50\t5')
  await page.getByRole('button', { name: 'Use pasted rows' }).click()
  await expect(page.getByLabel('Approval reference')).toHaveValue('CO-7')
  await expect(page.getByLabel('Approved scope', { exact: true })).toHaveValue('Night access')
  await expect(page.getByLabel('Approved cost budget change ($)')).toHaveValue('50')
  await page.getByRole('button', { name: 'Check scope', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Scope reconciliation' })).toBeVisible()
})
