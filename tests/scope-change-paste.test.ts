import { describe, expect, it } from 'vitest'
import { parseScopeChangePaste } from '../src/lib/scope-change-paste'

describe('scope-change spreadsheet paste', () => {
  it('parses tab-separated spreadsheet rows into the existing scope-change contract', () => {
    expect(parseScopeChangePaste('Reference\tDescription\tCategory\tBudget cost\tBudget hours\tActual cost\tActual hours\nCO-03\tAdditional circuits\tmaterials\t2400\t0\t2200\t0\nCO-04\tNight work\tlabor\t1250.50\t18\t1200\t16')).toEqual([
      { reference: 'CO-03', description: 'Additional circuits', category: 'materials', estimatedCost: 2400, estimatedHours: 0, actualCost: 2200, actualHours: 0 },
      { reference: 'CO-04', description: 'Night work', category: 'labor', estimatedCost: 1250.5, estimatedHours: 18, actualCost: 1200, actualHours: 16 },
    ])
  })

  it('supports quoted CSV descriptions and US-formatted amounts', () => {
    expect(parseScopeChangePaste('Approval reference,Approved scope,Cost category,Estimated cost,Estimated hours,Change actual cost,Change actual hours\nCO-05,"Devices, fixtures and controls",materials,"$1,250.00",0,1200,0')[0]).toMatchObject({ reference: 'CO-05', description: 'Devices, fixtures and controls', category: 'materials', estimatedCost: 1250 })
  })

  it('rejects missing fields, unsafe numbers, negative actuals, and duplicate reference/category rows', () => {
    const header = 'Reference,Description,Category,Budget cost,Budget hours,Actual cost,Actual hours\n'
    expect(() => parseScopeChangePaste(`${header}CO-1,Work,materials,TBD,0,0,0`)).toThrow('unambiguous number')
    expect(() => parseScopeChangePaste(`${header}CO-1,Work,materials,0,0,-1,0`)).toThrow('cannot be negative')
    expect(() => parseScopeChangePaste(`${header}CO-1,Work,materials,0,0,0,0\nCO-1,More work,materials,0,0,0,0`)).toThrow('one row per approval reference')
  })
})
