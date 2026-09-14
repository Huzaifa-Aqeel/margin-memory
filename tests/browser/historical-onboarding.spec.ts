import { expect, test } from '@playwright/test'
import { build } from 'vite'
import { fileURLToPath } from 'node:url'
import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

let script = ''
const screenshotDirectory = process.env.HISTORICAL_ONBOARDING_SCREENSHOT_DIR

test.beforeAll(async () => {
  const output = await build({ configFile: false, logLevel: 'error', define: { 'process.env.NODE_ENV': JSON.stringify('production') }, resolve: { alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)), 'next/navigation': fileURLToPath(new URL('./fixtures/test-router.ts', import.meta.url)) } }, esbuild: { jsx: 'automatic' }, build: { write: false, minify: false, lib: { entry: fileURLToPath(new URL('./fixtures/historical-onboarding.tsx', import.meta.url)), name: 'HistoricalOnboardingFixture', formats: ['iife'] } } })
  const outputs = Array.isArray(output) ? output : [output]
  const chunk = outputs.flatMap(value => 'output' in value ? value.output : []).find(item => item.type === 'chunk')
  if (!chunk || chunk.type !== 'chunk') throw new Error('Historical-onboarding fixture did not compile')
  script = chunk.code
  if (screenshotDirectory) mkdirSync(screenshotDirectory, { recursive: true })
})

test.beforeEach(async ({ page }) => {
  await page.goto('/login')
  const css = readFileSync(new URL('../../src/app/globals.css', import.meta.url), 'utf8')
  await page.setContent(`<!doctype html><html><head><style>${css}.fixture-switcher{margin-bottom:18px}</style></head><body><div id="root"></div></body></html>`)
  await page.addScriptTag({ content: script })
})

async function attachFiles(page: import('@playwright/test').Page, generic = false) {
  await page.locator('input[name="estimateFile"]').setInputFiles({ name: generic ? 'estimate.csv' : 'Baker Office Renovation - Final Estimate.csv', mimeType: 'text/csv', buffer: Buffer.from('Description,Category,Cost,Hours\nLabor,Labor,500,10\nWire,Materials,500,0\nGrand Total,,1000,10') })
  await page.locator('input[name="actualFile"]').setInputFiles({ name: generic ? 'job-cost-export.csv' : 'Baker Office Renovation - Actuals 2026-08-31.csv', mimeType: 'text/csv', buffer: Buffer.from('Description,Category,Cost,Hours\nLabor,Labor,500,10\nWire,Materials,500,0\nGrand Total,,1000,10') })
}

async function capture(page: import('@playwright/test').Page, name: string) {
  if (screenshotDirectory) await page.screenshot({ path: path.join(screenshotDirectory, `${name}.png`), fullPage: true })
}

async function confirmBaseline(page: import('@playwright/test').Page) {
  await page.getByRole('radio', { name: /Final submitted bid/ }).check()
}

test('streamlines a clean import and keeps source detail behind disclosure', async ({ page }) => {
  await attachFiles(page)
  await expect(page.getByLabel('Historical evidence progress')).toContainText('1 trusted completed job ready')
  await expect(page.getByText('Suggested', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Job name')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Analyze estimate and actuals' })).toBeDisabled()
  await confirmBaseline(page)
  await page.locator('input[name="notesFile"]').setInputFiles({ name: 'Baker Office closeout.md', mimeType: 'text/markdown', buffer: Buffer.from('Final costs confirmed by the project manager.') })
  await expect(page.getByRole('radio', { name: /Final submitted bid/ })).toBeChecked()
  await page.getByRole('button', { name: 'Analyze estimate and actuals' }).click()
  await expect(page.getByLabel('Import preview')).toContainText('2 detail rows recognized')
  await expect(page.getByLabel('Import preview')).toContainText('Actual cost coverage is complete')
  await expect(page.getByLabel('Import preview')).toContainText('Source total reconciles at $1,000')
  await expect(page.getByLabel('Job name')).toHaveValue('Baker Office Renovation')
  await expect(page.getByLabel('Completed date')).toHaveValue('2026-08-31')
  await expect(page.getByLabel('Project type')).toHaveValue('Office retrofit')
  await expect(page.getByLabel('Customer type')).toHaveValue('Commercial')
  await expect(page.getByLabel('I reviewed these specific limitations and want to continue.')).toHaveCount(0)
  await expect(page.getByText('Columns used:', { exact: false }).first()).toBeHidden()
  const importButton = page.getByRole('button', { name: 'Import completed job' })
  await expect(importButton).toBeDisabled()
  await page.getByLabel(/I confirm this is the final and complete actual-cost export/).check()
  await page.getByLabel(/Does the final work match the .* scope/).selectOption('no_changes')
  await expect(importButton).toBeEnabled()
  await capture(page, 'clean-review')
  await importButton.click()
  await expect(page.getByLabel('Completed job import result')).toContainText('Eligible for future Margin Checks')
  await expect(page.getByRole('button', { name: 'Import another similar job' })).toBeVisible()
  await capture(page, 'eligible-completion')
})

test('pairs and sequentially reviews several completed jobs with shared metadata', async ({ page }) => {
  await page.getByRole('button', { name: /Several completed jobs/ }).click()
  await page.getByLabel('Estimate files').setInputFiles([
    { name: 'Baker Office - Final Estimate.csv', mimeType: 'text/csv', buffer: Buffer.from('Description,Category,Cost,Hours\nLabor,Labor,500,10') },
    { name: 'Harbor Medical - Final Estimate.csv', mimeType: 'text/csv', buffer: Buffer.from('Description,Category,Cost,Hours\nLabor,Labor,500,10') },
  ])
  await page.getByLabel('Final actual-cost files').setInputFiles([
    { name: 'Harbor Medical - Actuals 2026-08-30.csv', mimeType: 'text/csv', buffer: Buffer.from('Description,Category,Cost,Hours\nLabor,Labor,500,10') },
    { name: 'Baker Office - Actuals 2026-08-31.csv', mimeType: 'text/csv', buffer: Buffer.from('Description,Category,Cost,Hours\nLabor,Labor,500,10') },
  ])
  await expect(page.getByLabel('Matching actuals').first()).toHaveValue('1')
  await expect(page.getByLabel('Matching actuals').last()).toHaveValue('0')
  await page.getByLabel('Comparison baseline').selectOption('final_submitted')
  await page.getByLabel('Project type (optional)').selectOption('Office retrofit')
  await page.getByLabel('Customer type (optional)').selectOption('Commercial')
  await page.getByRole('button', { name: 'Prepare paired reviews' }).click()
  await page.getByRole('button', { name: 'Analyze all pairs' }).click()
  const completeness = page.getByLabel(/I confirm this is the final and complete actual-cost export/)
  await expect(completeness).toHaveCount(2)
  for (const checkbox of await completeness.all()) await checkbox.check()
  const scopes = page.getByLabel(/Does the final work match the .* scope/)
  for (const scope of await scopes.all()) await scope.selectOption('no_changes')
  await expect(page.getByRole('button', { name: 'Import 2 ready jobs' })).toBeEnabled()
  await page.getByRole('button', { name: 'Import 2 ready jobs' }).click()
  await expect(page.getByLabel('Completed job import result')).toHaveCount(2)
})

test('asks only for an ambiguous worksheet and then reuses the resolved review', async ({ page }) => {
  await page.getByRole('button', { name: 'worksheet', exact: true }).click(); await attachFiles(page); await confirmBaseline(page)
  await page.getByRole('button', { name: 'Analyze estimate and actuals' }).click()
  await expect(page.getByText('Which worksheet contains the submitted estimate?')).toBeVisible()
  await expect(page.getByLabel('Job name')).toHaveCount(0)
  await page.getByLabel('Bid Detail').check()
  await page.getByRole('button', { name: 'Analyze selected source' }).click()
  await expect(page.getByLabel('Job name')).toHaveValue('Baker Office Renovation')
  await capture(page, 'worksheet-resolved')
})

test('asks only for the competing semantic column and binds the choice', async ({ page }) => {
  await page.getByRole('button', { name: 'mapping', exact: true }).click(); await attachFiles(page); await confirmBaseline(page)
  await page.getByRole('button', { name: 'Analyze estimate and actuals' }).click()
  await expect(page.getByText('Which estimate column contains row total?')).toBeVisible()
  await page.getByLabel(/cost column 4/i).check()
  await page.getByRole('button', { name: 'Analyze selected source' }).click()
  await expect(page.getByLabel('Job name')).toHaveValue('Baker Office Renovation')
  await capture(page, 'mapping-resolved')
})

test('explains partial actuals and archives only after explicit limitation and scope review', async ({ page }) => {
  await page.getByRole('button', { name: 'partial', exact: true }).click(); await attachFiles(page); await confirmBaseline(page)
  await page.getByRole('button', { name: 'Analyze estimate and actuals' }).click()
  await expect(page.getByLabel('Import preview')).toContainText('cannot be used for numerical historical evidence')
  await expect(page.getByLabel(/I confirm this is the final and complete actual-cost export/)).toHaveCount(0)
  await page.getByLabel(/I understand these specific limitations/).check()
  await page.getByLabel(/Does the final work match the .* scope/).selectOption('unreconciled')
  await expect(page.getByRole('button', { name: 'Import completed job' })).toBeEnabled()
  await capture(page, 'partial-actuals')
})

test('keeps hard-invalid sources blocked without showing the job administration form', async ({ page }) => {
  await page.getByRole('button', { name: 'blocked', exact: true }).click(); await attachFiles(page); await confirmBaseline(page)
  await page.getByRole('button', { name: 'Analyze estimate and actuals' }).click()
  await expect(page.getByLabel('Import preview')).toContainText('cannot be approved')
  await expect(page.getByLabel('Job name')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Import completed job' })).toHaveCount(0)
  await capture(page, 'hard-blocker')
})

test('leaves metadata blank when filenames are generic and reveals scope-change detail only on demand', async ({ page }) => {
  await attachFiles(page, true)
  await confirmBaseline(page)
  await page.getByRole('button', { name: 'Analyze estimate and actuals' }).click()
  await expect(page.getByLabel('Job name')).toHaveValue('')
  await expect(page.getByLabel('Completed date')).toHaveValue('')
  await expect(page.getByLabel('Project type')).toHaveValue('')
  await expect(page.getByLabel('Customer type')).toHaveValue('')
  await page.getByLabel(/Does the final work match the .* scope/).selectOption('adjusted')
  await expect(page.getByText('Scope change 1')).toBeVisible()
})

test('keeps an estimator correction when the same reviewed files are analyzed again', async ({ page }) => {
  await attachFiles(page)
  await confirmBaseline(page)
  await page.getByRole('button', { name: 'Analyze estimate and actuals' }).click()
  await page.getByLabel('Job name').fill('Baker Office Renovation — corrected')
  await page.getByRole('button', { name: 'Analyze estimate and actuals' }).click()
  await expect(page.getByLabel('Job name')).toHaveValue('Baker Office Renovation — corrected')
})
