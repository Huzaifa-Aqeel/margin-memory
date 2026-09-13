import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

describe('normal estimator-facing surface', () => {
  it('does not expose the removed score or runtime telemetry on estimate detail', () => {
    const page = source('src/app/estimates/[id]/page.tsx')
    expect(page).not.toContain('attention score')
    expect(page).not.toContain('riskScore')
    expect(page).not.toContain('Strands')
    expect(page).not.toContain('agent cycles')
    expect(page).not.toContain('toolsUsed.map')
    expect(page).not.toContain('TypeScript tools')
    expect(page).toContain('Historical evidence')
    expect(page).toContain('recorded calculation')
  })

  it('keeps Lessons available without exposing memory infrastructure controls', () => {
    const page = source('src/app/memory/page.tsx')
    expect(page).toContain('Company lessons')
    expect(page).toContain('LessonActions')
    expect(page).not.toContain('MemoryReadiness')
    expect(page).not.toMatch(/embedding|vector|reindex|rebuild|indexing/i)
  })

  it('uses professional primary navigation and demotes Lessons', () => {
    const shell = source('src/components/app-shell.tsx')
    expect(shell).toContain("label:'Estimates'")
    expect(shell).toContain("label:'Job history'")
    expect(shell).toContain("label:'Inbox'")
    expect(shell).toContain("label:'Lessons'")
    expect(shell).not.toContain("label:'Preflight'")
    expect(shell).not.toContain("label:'Memory'")
    expect(shell.indexOf("const lessons=")).toBeGreaterThan(shell.indexOf("const nav="))
  })

  it('keeps the dashboard focused on current work and restrains small-sample calibration', () => {
    const dashboard = source('src/app/page.tsx')
    expect(dashboard).toContain('Open findings')
    expect(dashboard).toContain('Active estimates')
    expect(dashboard).toContain('Historical evidence ready')
    expect(dashboard).toContain('presentWarningEffectiveness')
    expect(dashboard).not.toContain('Adjusted budget variance')
    expect(dashboard).not.toContain('attention score')
  })
})
