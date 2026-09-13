import { expect, test } from '@playwright/test'
import { build } from 'vite'
import { fileURLToPath } from 'node:url'
import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

let script = ''
const screenshotDirectory = process.env.SURFACE_AUDIT_SCREENSHOT_DIR

test.beforeAll(async () => {
  const output = await build({ configFile: false, logLevel: 'error', define: { 'process.env.NODE_ENV': JSON.stringify('production') }, resolve: { alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) } }, esbuild: { jsx: 'automatic' }, build: { write: false, minify: false, lib: { entry: fileURLToPath(new URL('./fixtures/surface-hardening.tsx', import.meta.url)), name: 'SurfaceHardeningFixture', formats: ['iife'] } } })
  const outputs = Array.isArray(output) ? output : [output]
  const chunk = outputs.flatMap(value => 'output' in value ? value.output : []).find(item => item.type === 'chunk')
  if (!chunk || chunk.type !== 'chunk') throw new Error('Surface-hardening fixture did not compile')
  script = chunk.code
  if (screenshotDirectory) mkdirSync(screenshotDirectory, { recursive: true })
})

test.beforeEach(async ({ page }) => {
  await page.goto('/login')
  const css = readFileSync(new URL('../../src/app/globals.css', import.meta.url), 'utf8')
  await page.setContent(`<!doctype html><html><head><style>${css}.fixture-switcher{padding:12px;background:#fff;border-bottom:1px solid #ddd}.fixture-switcher button{padding:7px}.fixture-shell{display:grid;grid-template-columns:246px 1fr;min-height:700px}.fixture-shell .page{margin:0}</style></head><body><div id="root"></div></body></html>`)
  await page.addScriptTag({ content: script })
})

async function capture(page: import('@playwright/test').Page, name: string) {
  if (screenshotDirectory) await page.locator('.fixture-shell').screenshot({ path: path.join(screenshotDirectory, `${name}.png`) })
}

test('presents every Margin Check state truthfully', async ({ page }) => {
  const cases = [
    ['Queued', 'queued', 'Margin Check is waiting to run.'],
    ['Running', 'investigating', 'Running Margin Check…'],
    ['Needs information', 'needs_input', 'One or more details need your review.'],
    ['Failed', 'failed', 'Your estimate has not been cleared.'],
    ['Findings', 'findings', '1 item deserves review.'],
    ['No findings', 'no_findings', 'No material historical risks found.'],
  ] as const
  for (const [button, state, message] of cases) {
    await page.getByRole('button', { name: button, exact: true }).click()
    await expect(page.getByLabel('Margin Check status')).toHaveAttribute('data-margin-check-state', state)
    await expect(page.getByLabel('Margin Check status')).toContainText(message)
    if (state !== 'no_findings') await expect(page.getByText('No material historical risks found.')).toHaveCount(0)
    await capture(page, `estimate-detail-${state}`)
  }
  await page.getByRole('button', { name: 'Findings', exact: true }).click()
  await expect(page.getByText(/Evidence strength: Moderate/)).toBeVisible()
})

test('shows professional navigation, restrained dashboard calibration, Estimates, and Lessons', async ({ page }) => {
  await expect(page.getByLabel('Primary navigation')).toContainText('Estimates')
  await expect(page.getByLabel('Primary navigation')).toContainText('Job history')
  await expect(page.getByLabel('Primary navigation')).not.toContainText('Preflight')
  await expect(page.getByLabel('Primary navigation')).not.toContainText('Memory')
  await expect(page.getByLabel('Dashboard fixture')).toContainText('3 reviewed')
  await expect(page.getByLabel('Dashboard fixture')).not.toContainText('100%')
  await capture(page, 'dashboard')
  await page.getByRole('button', { name: 'Estimate list' }).click()
  await expect(page.getByRole('heading', { name: 'Estimates' })).toBeVisible()
  await capture(page, 'estimate-list')
  await page.getByRole('button', { name: 'Lessons', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Verified experience worth carrying forward' })).toBeVisible()
  await expect(page.getByText('confirmed', { exact: true })).toBeVisible()
  await capture(page, 'lessons')
  await expect(page.locator('body')).not.toContainText(/Strands|agent cycles|tool count|embedding model|vector|rebuild memory|attention score|TypeScript tools/i)
})
